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

# Must be a client component to use signOut and window
if ($src -notmatch '"use client"' -and $src -notmatch "'use client'") {
  Fail "[FAIL] Missing 'use client' in app\\passenger\\page.tsx. Refusing to inject client hooks."
}

# Ensure the signout marker exists (we inserted it earlier)
if ($src -notmatch "JRIDE_SIGNOUT_BUTTON_BEGIN" -or $src -notmatch "JRIDE_SIGNOUT_BUTTON_END") {
  Fail "[FAIL] Missing JRIDE_SIGNOUT_BUTTON_BEGIN/END markers. Refusing to guess where the Sign out button is."
}

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

# 1) Remove any previously inserted bfcache guard block (if present)
$src2 = $src
$src2 = [regex]::Replace(
  $src2,
  "(?s)\s*//\s*JRIDE_BFCACHE_GUARD_BEGIN.*?//\s*JRIDE_BFCACHE_GUARD_END\s*",
  "`r`n",
  1
)

# 2) Replace the entire signout marker block with a known-good JSX block (no fragile regex on onClick)
$blockPattern = "(?s)\{/\*\s*JRIDE_SIGNOUT_BUTTON_BEGIN\s*\*/\}.*?\{/\*\s*JRIDE_SIGNOUT_BUTTON_END\s*\*/\}"
$m = [regex]::Match($src2, $blockPattern)
if (-not $m.Success) { Fail "[FAIL] Could not locate the full JSX marker block for Sign out." }

$goodBlock = @'
{/* JRIDE_SIGNOUT_BUTTON_BEGIN */}
<button
  type="button"
  className="ml-2 rounded border px-3 py-1 text-xs hover:bg-gray-50"
  onClick={async () => {
    await signOut({ redirect: false });
    window.location.href = "/auth/signin";
  }}
>
  Sign out
</button>
{/* JRIDE_SIGNOUT_BUTTON_END */}
'@

$src2 = [regex]::Replace($src2, $blockPattern, $goodBlock, 1)
Ok "[OK] Replaced Sign out marker block with known-good hard logout to /auth/signin"

# 3) Insert bfcache/pageshow guard safely right BEFORE the first 'return (' inside the component
if ($src2 -notmatch "JRIDE_BFCACHE_GUARD_BEGIN") {
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

  $returnIdx = $src2.IndexOf("return (")
  if ($returnIdx -lt 0) { Fail "[FAIL] Could not find 'return (' in app\\passenger\\page.tsx to anchor bfcache guard." }

  $src2 = $src2.Insert($returnIdx, $guard)
  Ok "[OK] Inserted bfcache pageshow guard before return("
} else {
  Ok "[OK] bfcache guard already present"
}

WriteUtf8NoBom $target $src2
Ok "[OK] Wrote UTF-8 (no BOM)"
Ok "[DONE] FIX-JRIDE_PASSENGER_PAGE_SIGNOUT_AND_BFCACHE_V1_PS5SAFE"
