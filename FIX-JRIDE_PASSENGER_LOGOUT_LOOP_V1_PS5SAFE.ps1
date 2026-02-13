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

if ($src -notmatch "JRIDE_SIGNOUT_BUTTON_BEGIN" -or $src -notmatch "JRIDE_SIGNOUT_BUTTON_END") {
  Fail "[FAIL] Missing JRIDE_SIGNOUT_BUTTON_BEGIN/END markers. Refusing to guess."
}

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

$src2 = $src

# 1) Remove any bfcache guard blocks (both possible marker variants we used)
$src2 = [regex]::Replace(
  $src2,
  "(?s)\s*//\s*JRIDE_BFCACHE_GUARD_BEGIN.*?//\s*JRIDE_BFCACHE_GUARD_END\s*",
  "`r`n",
  10
)
$src2 = [regex]::Replace(
  $src2,
  "(?s)\s*//\s*JRIDE_BFCACHE_GUARD_BEGIN.*?//\s*JRIDE_BFCACHE_GUARD_END\s*",
  "`r`n",
  10
)

# Also remove any earlier variant inserted as comment markers
$src2 = [regex]::Replace(
  $src2,
  "(?s)\s*//\s*JRIDE_BFCACHE_GUARD_BEGIN.*?JRIDE_BFCACHE_GUARD_END\s*",
  "`r`n",
  10
)

# 2) Replace Sign out marker block with a stable handler that never loops
$signoutBlockPattern = "(?s)\{/\*\s*JRIDE_SIGNOUT_BUTTON_BEGIN\s*\*/\}.*?\{/\*\s*JRIDE_SIGNOUT_BUTTON_END\s*\*/\}"
$m = [regex]::Match($src2, $signoutBlockPattern)
if (-not $m.Success) { Fail "[FAIL] Could not locate full JSX signout marker block to replace." }

$goodSignoutBlock = @'
{/* JRIDE_SIGNOUT_BUTTON_BEGIN */}
<button
  type="button"
  className="ml-2 rounded border px-3 py-1 text-xs hover:bg-gray-50"
  onClick={async () => {
    // Logout works already (session becomes null). Avoid reload loops.
    try { await signOut({ redirect: false }); } catch {}
    window.location.replace("/auth/signin");
  }}
>
  Sign out
</button>
{/* JRIDE_SIGNOUT_BUTTON_END */}
'@

$src2 = [regex]::Replace($src2, $signoutBlockPattern, $goodSignoutBlock, 1)
Ok "[OK] Replaced Sign out block + removed bfcache reload guard"

WriteUtf8NoBom $target $src2
Ok "[OK] Wrote UTF-8 (no BOM)"
Ok "[DONE] FIX-JRIDE_PASSENGER_LOGOUT_LOOP_V1_PS5SAFE"
