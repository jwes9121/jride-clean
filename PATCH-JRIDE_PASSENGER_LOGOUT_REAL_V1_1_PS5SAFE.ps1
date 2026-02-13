param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }

function EnsureDir([string]$p){
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  EnsureDir (Split-Path -Parent $path)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$path, [string]$repoRoot) {
  $bakDir = Join-Path $repoRoot "_patch_bak"
  EnsureDir $bakDir
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($path)
  $bak = Join-Path $bakDir ("{0}.bak.{1}" -f $name, $ts)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  return $bak
}

# Validate repo root
$pkg = Join-Path $RepoRoot "package.json"
if (!(Test-Path -LiteralPath $pkg)) {
  Fail "[FAIL] package.json not found. Run from repo root."
}

$passengerPage = Join-Path $RepoRoot "app\passenger\page.tsx"
if (!(Test-Path -LiteralPath $passengerPage)) { Fail "[FAIL] Missing app\passenger\page.tsx" }

$logoutRoute = Join-Path $RepoRoot "app\api\public\auth\logout\route.ts"

# Backup
$bak = BackupFile $passengerPage $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $passengerPage)

$src = Get-Content -LiteralPath $passengerPage -Raw

if ($src -notmatch "JRIDE_SIGNOUT_BUTTON_BEGIN" -or $src -notmatch "JRIDE_SIGNOUT_BUTTON_END") {
  Fail "[FAIL] Missing JRIDE_SIGNOUT_BUTTON_BEGIN/END markers. Refusing to guess."
}

# Remove NextAuth signOut import if present (passenger is phone/password)
$src2 = $src
$src2 = [regex]::Replace($src2, "(?m)^\s*import\s*\{\s*signOut\s*\}\s*from\s*`"next-auth/react`";\s*\r?\n", "")

# Replace signout block to call custom passenger logout endpoint
$signoutBlockPattern = "(?s)\{/\*\s*JRIDE_SIGNOUT_BUTTON_BEGIN\s*\*/\}.*?\{/\*\s*JRIDE_SIGNOUT_BUTTON_END\s*\*/\}"

$goodSignoutBlock = @'
{/* JRIDE_SIGNOUT_BUTTON_BEGIN */}
<button
  type="button"
  className="ml-2 rounded border px-3 py-1 text-xs hover:bg-gray-50"
  onClick={async () => {
    try {
      await fetch("/api/public/auth/logout", { method: "POST", cache: "no-store" });
    } catch {}
    window.location.replace("/passenger-login");
  }}
>
  Sign out
</button>
{/* JRIDE_SIGNOUT_BUTTON_END */}
'@

if (-not ([regex]::Match($src2, $signoutBlockPattern)).Success) {
  Fail "[FAIL] Could not locate full JSX Sign out marker block to replace."
}
$src2 = [regex]::Replace($src2, $signoutBlockPattern, $goodSignoutBlock, 1)

# Fix mojibake text / normalize to ASCII "8PM-5AM"
# We replace any variant that mentions Night booking and 8PM..5AM into ASCII.
$src2 = [regex]::Replace(
  $src2,
  "Night booking\s*\(8PM.*?5AM\)\s*requires verification\.",
  "Night booking (8PM-5AM) requires verification.",
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

WriteUtf8NoBom $passengerPage $src2
Ok "[OK] Patched app/passenger/page.tsx (passenger logout + ASCII night text)"

# Write logout route that clears all cookies seen on request
$routeContent = @'
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function clearAllCookies(req: NextRequest, res: NextResponse) {
  const all = req.cookies.getAll();
  for (const c of all) {
    try {
      res.cookies.set({
        name: c.name,
        value: "",
        path: "/",
        expires: new Date(0),
      });
    } catch {}
  }
  for (const c of all) {
    try {
      res.cookies.set({
        name: c.name,
        value: "",
        path: "/api",
        expires: new Date(0),
      });
    } catch {}
  }
}

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearAllCookies(req, res);
  return res;
}

export async function GET(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearAllCookies(req, res);
  return res;
}
'@

WriteUtf8NoBom $logoutRoute $routeContent
Ok ("[OK] Wrote route: {0}" -f $logoutRoute)

Ok "[DONE] PATCH-JRIDE_PASSENGER_LOGOUT_REAL_V1_1_PS5SAFE"
Ok "[NEXT] Run: npm.cmd run build"
