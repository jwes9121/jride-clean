param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$path, [string]$repoRoot) {
  $bakDir = Join-Path $repoRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($path)
  $bak = Join-Path $bakDir ("{0}.bak.{1}" -f $name, $ts)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  return $bak
}

function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m) { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }

$target = Join-Path $RepoRoot "app\passenger\page.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing target: app\passenger\page.tsx" }

$src = Get-Content -LiteralPath $target -Raw

# Must be client component
if ($src -notmatch '"use client"' -and $src -notmatch "'use client'") {
  Fail "[FAIL] Missing 'use client' in app\\passenger\\page.tsx."
}

# Must contain our signout marker block
if ($src -notmatch "JRIDE_SIGNOUT_BUTTON_BEGIN" -or $src -notmatch "JRIDE_SIGNOUT_BUTTON_END") {
  Fail "[FAIL] Missing JRIDE_SIGNOUT_BUTTON_BEGIN/END markers. Refusing to guess."
}

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

$src2 = $src

# 1) Remove any existing bfcache guard block (wherever it ended up)
$src2 = [regex]::Replace(
  $src2,
  "(?s)\s*//\s*JRIDE_BFCACHE_GUARD_BEGIN.*?//\s*JRIDE_BFCACHE_GUARD_END\s*",
  "`r`n",
  10
)

# 2) Force replace the ENTIRE signout marker block with a known-good one
$signoutBlockPattern = "(?s)\{/\*\s*JRIDE_SIGNOUT_BUTTON_BEGIN\s*\*/\}.*?\{/\*\s*JRIDE_SIGNOUT_BUTTON_END\s*\*/\}"

$goodSignoutBlock = @'
{/* JRIDE_SIGNOUT_BUTTON_BEGIN */}
<button
  type="button"
  className="ml-2 rounded border px-3 py-1 text-xs hover:bg-gray-50"
  onClick={async () => {
    // Hard logout + hard redirect (prevents bfcache/back restoring the old page)
    await signOut({ redirect: false });
    window.location.replace("/auth/signin");
  }}
>
  Sign out
</button>
{/* JRIDE_SIGNOUT_BUTTON_END */}
'@

if (-not ([regex]::Match($src2, $signoutBlockPattern)).Success) {
  Fail "[FAIL] Could not locate full JSX signout marker block to replace."
}

$src2 = [regex]::Replace($src2, $signoutBlockPattern, $goodSignoutBlock, 1)
Ok "[OK] Replaced Sign out marker block with hard redirect to /auth/signin"

# 3) Insert bfcache guard in a safe place: directly after the 'use client' directive line
# This guarantees it is NOT inside any callback/component; then it will be moved into component via effect? No.
# Hooks must be inside component, so we will insert a small top-level helper and then call it inside component.
# However calling hooks at top-level is illegal, so we DO NOT. We instead insert the hook block inside component
# by anchoring on the FIRST component opening brace found after exports.

$guard = @'
  // JRIDE_BFCACHE_GUARD_BEGIN
  React.useEffect(() => {
    const onShow = () => {
      fetch("/api/auth/session", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!j) window.location.reload();
        })
        .catch(() => {});
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  // JRIDE_BFCACHE_GUARD_END

'@

# Try to anchor inside the top-level component:
# Patterns:
#  - export default function X(...) {
#  - function X(...) { ... export default X
#  - const X = (...) => { ... export default X
$inserted = $false

$patterns = @(
  "(?m)^(export\s+default\s+function\s+[A-Za-z0-9_]*\s*\([^\)]*\)\s*\{)",
  "(?m)^(export\s+default\s+function\s*\([^\)]*\)\s*\{)",
  "(?m)^(function\s+[A-Za-z0-9_]+\s*\([^\)]*\)\s*\{)",
  "(?m)^(const\s+[A-Za-z0-9_]+\s*=\s*\([^\)]*\)\s*=>\s*\{)",
  "(?m)^(const\s+[A-Za-z0-9_]+\s*=\s*\(\)\s*=>\s*\{)"
)

foreach ($pat in $patterns) {
  $m = [regex]::Match($src2, $pat)
  if ($m.Success) {
    $pos = $m.Index + $m.Length
    $src2 = $src2.Insert($pos, "`r`n" + $guard)
    $inserted = $true
    Ok ("[OK] Inserted bfcache guard inside component anchor: {0}" -f $pat)
    break
  }
}

if (-not $inserted) {
  Fail "[FAIL] Could not find a safe component function anchor to place React.useEffect. Paste the top of app\\passenger\\page.tsx (first 60 lines)."
}

# Sanity: ensure exactly one guard block
$cnt = ([regex]::Matches($src2, "JRIDE_BFCACHE_GUARD_BEGIN")).Count
if ($cnt -ne 1) { Fail ("[FAIL] Guard marker count is {0} after insertion. Refusing to write." -f $cnt) }

WriteUtf8NoBom $target $src2
Ok "[OK] Wrote UTF-8 (no BOM)"
Ok "[DONE] FIX-JRIDE_PASSENGER_SIGNOUT_REDIRECT_AND_HOOKS_V2_PS5SAFE"
