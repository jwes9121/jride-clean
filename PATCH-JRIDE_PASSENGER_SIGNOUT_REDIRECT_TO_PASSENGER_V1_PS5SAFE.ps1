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

$target = Join-Path $RepoRoot "app\passenger\page.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing target: app\passenger\page.tsx" }

$src = Get-Content -LiteralPath $target -Raw

if ($src -notmatch "JRIDE_SIGNOUT_BUTTON_BEGIN" -or $src -notmatch "JRIDE_SIGNOUT_BUTTON_END") {
  Fail "[FAIL] Missing JRIDE_SIGNOUT_BUTTON_BEGIN/END markers. Refusing to guess."
}

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

# Replace any auth/signin redirect with /passenger
$src2 = $src `
  -replace "window\.location\.replace\(`"/auth/signin`"\)", "window.location.replace(`"/passenger`")" `
  -replace 'window\.location\.replace\("/auth/signin"\)', 'window.location.replace("/passenger")' `
  -replace "callbackUrl:\s*`"/auth/signin`"", "callbackUrl: `"/passenger`"" `
  -replace 'callbackUrl:\s*"/auth/signin"', 'callbackUrl: "/passenger"'

WriteUtf8NoBom $target $src2
Ok "[OK] Passenger Sign out redirect changed to /passenger"
Ok "[DONE] PATCH-JRIDE_PASSENGER_SIGNOUT_REDIRECT_TO_PASSENGER_V1_PS5SAFE"
