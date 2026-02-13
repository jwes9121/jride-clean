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

$target = Join-Path $RepoRoot "app\api\public\passenger\can-book\route.ts"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing can-book route.ts" }

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

$src = Get-Content -LiteralPath $target -Raw

# Remove the injected line (with flexible whitespace)
$pattern = "(?m)^\s*local_bypass_used:\s*!!localOk,\s*\r?\n"
if (-not ([regex]::IsMatch($src, $pattern))) {
  Warn "[WARN] local_bypass_used line not found. Nothing to remove."
  exit 0
}

$src2 = [regex]::Replace($src, $pattern, "", 1)

WriteUtf8NoBom $target $src2
Ok "[OK] Removed local_bypass_used reference to localOk"
Ok "[DONE] PATCH-JRIDE_CANBOOK_REMOVE_LOCAL_BYPASS_USED_V1_PS5SAFE"
Ok "[NEXT] Run: npm.cmd run build"
