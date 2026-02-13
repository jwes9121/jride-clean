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

$target = Join-Path $RepoRoot "app\api\public\passenger\can-book\route.ts"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing target: app\api\public\passenger\can-book\route.ts" }

$src = Get-Content -LiteralPath $target -Raw

if ($src -notmatch "jrideIsPassengerVerifiedFromStatus") {
  Fail "[FAIL] Expected helper jrideIsPassengerVerifiedFromStatus not found. Refusing to patch unknown shape."
}

# Fix the exact bad reference: vRow?.status ?? row?.status  -> row?.status
$before = "vRow?.status ?? row?.status"
$after  = "row?.status"

if ($src -notmatch [regex]::Escape($before)) {
  Fail "[FAIL] Did not find the exact token 'vRow?.status ?? row?.status'. Refusing to guess."
}

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

$src2 = $src -replace [regex]::Escape($before), $after

WriteUtf8NoBom $target $src2
Ok "[OK] Replaced vRow reference with row?.status"
Ok "[OK] Wrote UTF-8 (no BOM)"
Ok "[DONE] PATCH-JRIDE_PASSENGER_CANBOOK_VERIFIED_STATUS_V1_1_FIX_VROW_PS5SAFE"
