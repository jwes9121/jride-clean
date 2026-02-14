param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot,
  [int64]$MaxBytes = 2000000
)

$ErrorActionPreference="Stop"
function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }

cd $ProjRoot

$path = "app/ride/page.tsx"
if (-not (Test-Path -LiteralPath $path)) { Fail "[FAIL] Missing $path" }

$commits = git rev-list --all -- $path
if (-not $commits) { Fail "[FAIL] No history found for $path" }

$pick = $null
$pickSize = $null

# rev-list returns newest first → we pick the first blob under MaxBytes
foreach ($c in $commits) {
  $blob = git rev-parse "$c`:$path" 2>$null
  if (-not $blob) { continue }
  $sz = [int64](git cat-file -s $blob)
  if ($sz -le $MaxBytes) { $pick = $c; $pickSize = $sz; break }
}

if (-not $pick) {
  Fail ("[FAIL] No version found under {0} bytes. Try raising -MaxBytes." -f $MaxBytes)
}

Ok ("[OK] Latest version under {0} bytes:" -f $MaxBytes)
Ok ("[OK] Commit: {0}" -f $pick)
Ok ("[OK] Size:   {0} bytes (~{1} KB)" -f $pickSize, [math]::Round($pickSize/1KB,2))

Write-Host ""
Write-Host "NEXT COMMAND (restore that version into working tree):" -ForegroundColor Cyan
Write-Host ("git checkout {0} -- {1}" -f $pick, $path) -ForegroundColor Cyan
