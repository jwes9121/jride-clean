# PATCH-PHASE3K_ASSIGN_DECLARE_MANUAL_DRIVER_ID_V2.ps1
# Ensures "const manual_driver_id = ..." exists in POST() in app/api/dispatch/assign/route.ts
# Inserts it just before the "// ----- MANUAL_DRIVER_SELECTED -----" block.
# ASCII-only, UTF-8 no BOM.

$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }
function BackupFile($p){
  if (!(Test-Path $p)) { Fail "Missing file: $p" }
  $bak = "$p.bak.$(Stamp)"
  Copy-Item -Force $p $bak
  Write-Host "[OK] Backup: $bak"
}
function ReadLines($p){ Get-Content -Encoding UTF8 $p }
function WriteLines($p, $lines){
  $txt = ($lines -join "`n")
  Set-Content -Encoding UTF8 -NoNewline -Path $p -Value $txt
  Write-Host "[OK] Wrote: $p"
}
function IndexOfExact($lines, $pattern){
  for ($i=0; $i -lt $lines.Count; $i++){
    if ($lines[$i] -match $pattern) { return $i }
  }
  return -1
}

$root = Get-Location
$target = Join-Path $root "app\api\dispatch\assign\route.ts"

BackupFile $target
$L = ReadLines $target
$all = ($L -join "`n")

# If declaration already exists, stop.
if ($all -match "(?m)^\s*const\s+manual_driver_id\s*=") {
  Write-Host "[OK] const manual_driver_id already declared. No changes needed."
  Write-Host "DONE: PHASE3K assign declare manual_driver_id V2 (no-op)."
  exit 0
}

# Find anchor comment block
$anchor = IndexOfExact $L "^\s*//\s*-{2,}\s*MANUAL_DRIVER_SELECTED\s*-{2,}\s*$"
if ($anchor -lt 0) {
  Fail "Anchor not found: // ----- MANUAL_DRIVER_SELECTED -----"
}

# Insert declaration right before the anchor line
$indent = ""
if ($L[$anchor] -match "^(?<sp>\s*)") { $indent = $Matches["sp"] }

$insert = @(
  ($indent + "const manual_driver_id = (body as any)?.manual_driver_id ?? (body as any)?.driver_id ?? (body as any)?.driverId ?? null;"),
  ""
)

$before = @()
if ($anchor -gt 0) { $before = $L[0..($anchor-1)] }
$after = $L[$anchor..($L.Count-1)]

$L2 = $before + $insert + $after

Write-Host "[OK] Inserted const manual_driver_id declaration before MANUAL_DRIVER_SELECTED block"
WriteLines $target $L2
Write-Host "DONE: PHASE3K assign declare manual_driver_id V2 applied."
