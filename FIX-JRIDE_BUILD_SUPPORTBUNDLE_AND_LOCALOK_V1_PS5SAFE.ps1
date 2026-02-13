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
if (!(Test-Path -LiteralPath $pkg)) { Fail "[FAIL] package.json not found. Run from repo root." }

# 1) Delete _support_bundle to stop TS checking copied files
$bundleDir = Join-Path $RepoRoot "_support_bundle"
if (Test-Path -LiteralPath $bundleDir) {
  try {
    Remove-Item -LiteralPath $bundleDir -Recurse -Force
    Ok "[OK] Deleted _support_bundle (prevents TypeScript from checking bundle copies)"
  } catch {
    Fail "[FAIL] Could not delete _support_bundle. Close editors/terminals using it and re-run."
  }
} else {
  Warn "[WARN] _support_bundle not found (already removed)"
}

# 2) Patch real booking route to define localOk before first use
$bookPath = Join-Path $RepoRoot "app\api\public\passenger\book\route.ts"
if (!(Test-Path -LiteralPath $bookPath)) { Fail "[FAIL] Missing: app/api/public/passenger/book/route.ts" }

$bak = BackupFile $bookPath $RepoRoot
Ok ("[OK] Backup book route: {0}" -f $bak)

$src = Get-Content -LiteralPath $bookPath -Raw

# If localOk is already declared somewhere, we won't double-insert.
if ($src -match "(?m)^\s*const\s+localOk\s*=") {
  Warn "[WARN] localOk already declared in book route (skipping localOk insert)."
} else {

  # Anchor on the first known use you showed:
  $needle = 'if (!localOk && (!Number.isFinite(lat) || !Number.isFinite(lng))) {'
  $idx = $src.IndexOf($needle)
  if ($idx -lt 0) {
    Fail "[FAIL] Could not find the first localOk usage line in book route. Refusing to guess."
  }

  $insert = @'
  // JRIDE_LOCALOK_DEFINE_BEGIN
  // Ensure localOk is defined before any use (prevents TS build failure).
  // localOk = env JRIDE_LOCAL_VERIFY_CODE matches body local_verification_code/local_verify.
  const expectedLocal = String(process.env.JRIDE_LOCAL_VERIFY_CODE || "").trim();
  const providedLocal = String(((body as any)?.local_verification_code || (body as any)?.local_verify || "")).trim();
  const localOk = (!!expectedLocal && !!providedLocal && (providedLocal === expectedLocal));
  // JRIDE_LOCALOK_DEFINE_END

'@

  $src = $src.Insert($idx, $insert)
  Ok "[OK] Inserted localOk definition before first usage"
}

WriteUtf8NoBom $bookPath $src
Ok "[OK] Wrote patched book route (UTF-8 no BOM)"

Ok "[DONE] FIX-JRIDE_BUILD_SUPPORTBUNDLE_AND_LOCALOK_V1_PS5SAFE"
Ok "[NEXT] Run: npm.cmd run build"
