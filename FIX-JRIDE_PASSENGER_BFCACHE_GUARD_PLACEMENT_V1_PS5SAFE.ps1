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

if ($src -notmatch '"use client"' -and $src -notmatch "'use client'") {
  Fail "[FAIL] Missing 'use client' in app\\passenger\\page.tsx. Refusing to inject client hooks."
}

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

# 1) Remove any existing bfcache guard block (wherever it ended up)
$src2 = [regex]::Replace(
  $src,
  "(?s)\s*//\s*JRIDE_BFCACHE_GUARD_BEGIN.*?//\s*JRIDE_BFCACHE_GUARD_END\s*",
  "`r`n",
  1
)

if ($src2 -ne $src) {
  Ok "[OK] Removed existing JRIDE_BFCACHE_GUARD block (bad placement)"
} else {
  Warn "[WARN] No existing JRIDE_BFCACHE_GUARD block found (continuing)"
}

# 2) Insert guard immediately inside the top-level component function body
# We support: export default function X(...) {  OR export default function(...) {
$fnPattern = "(?m)^(export\s+default\s+function\s+[A-Za-z0-9_]*\s*\([^\)]*\)\s*\{)"
$fnMatch = [regex]::Match($src2, $fnPattern)
if (-not $fnMatch.Success) {
  # Fallback: export default function(...) {
  $fnPattern2 = "(?m)^(export\s+default\s+function\s*\([^\)]*\)\s*\{)"
  $fnMatch = [regex]::Match($src2, $fnPattern2)
}

if (-not $fnMatch.Success) {
  Fail "[FAIL] Could not locate 'export default function ... {'. Paste the top of app\\passenger\\page.tsx so we can anchor safely."
}

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

$insertPos = $fnMatch.Index + $fnMatch.Length
$src3 = $src2.Insert($insertPos, "`r`n" + $guard)

# Sanity: ensure guard is now near top and only once
$cnt = ([regex]::Matches($src3, "JRIDE_BFCACHE_GUARD_BEGIN")).Count
if ($cnt -ne 1) { Fail "[FAIL] Guard marker count is not 1 after insertion. Refusing to write." }

WriteUtf8NoBom $target $src3
Ok "[OK] Inserted bfcache guard at top-level component scope"
Ok "[OK] Wrote UTF-8 (no BOM)"
Ok "[DONE] FIX-JRIDE_PASSENGER_BFCACHE_GUARD_PLACEMENT_V1_PS5SAFE"
