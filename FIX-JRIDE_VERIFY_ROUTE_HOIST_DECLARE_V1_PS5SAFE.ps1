param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host $m -ForegroundColor Green }
function Write-Fail($m) { Write-Host $m -ForegroundColor Red }

Write-Info "== JRIDE Fix: Verify route hoist block -> declarations (V1 / PS5-safe) =="

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$target = Join-Path $proj "app\api\public\passenger\verification\request\route.ts"

if (!(Test-Path -LiteralPath $target)) {
  Write-Fail "[FAIL] Not found: $target"
  exit 1
}

# backup
$bakDir = Join-Path $proj "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.bak.VERIFY_HOIST_DECLARE_V1.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Ok "[OK] Backup: $bak"

$lines = Get-Content -LiteralPath $target

$comment = "// Hoisted vars so validation below can see them (try/catch must not hide scope)"

# Find the comment line index
$idx = -1
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i].Trim() -eq $comment) { $idx = $i; break }
}
if ($idx -lt 0) {
  Write-Fail "[FAIL] Could not find hoist comment line."
  exit 2
}

# We expect the next 6 lines to be assignments like: full_name = "";
# We'll replace the block starting at idx+1 through idx+6 (or until blank/try) with declarations.
$start = $idx + 1
$end = $start

for ($j=$start; $j -lt $lines.Count; $j++) {
  $t = $lines[$j].Trim()
  if ($t -eq "" -or $t.StartsWith("try ")) { break }
  $end = $j
  # stop once we've passed the known vars (safety cap)
  if (($end - $start) -ge 10) { break }
}

$decl = @(
  "  let full_name = `"`";",
  "  let town = `"`";",
  "  let id_front_path = `"`";",
  "  let selfie_with_id_path = `"`";",
  "  let id_photo_url = `"`";",
  "  let selfie_photo_url = `"`";",
  ""
)

# Build new file lines
$new = @()
for ($k=0; $k -lt $lines.Count; $k++) {
  if ($k -eq $start) {
    $new += $decl
    $k = $end
    continue
  }
  $new += $lines[$k]
}

Set-Content -LiteralPath $target -Value $new -Encoding UTF8
Write-Ok "[OK] Replaced assignment hoist block with let declarations."
Write-Info "Patched: $target"