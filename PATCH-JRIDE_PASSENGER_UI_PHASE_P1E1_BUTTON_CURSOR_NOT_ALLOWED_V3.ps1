# PATCH-JRIDE_PASSENGER_UI_PHASE_P1E1_BUTTON_CURSOR_NOT_ALLOWED_V3.ps1
# PHASE P1E.1 (UI-only): Improve disabled visuals for shared <Button />
# - Replace disabled:pointer-events-none with disabled:cursor-not-allowed
# - Keep disabled:opacity-50
# - No behavior / logic changes

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Read-Utf8NoBom($p){
  if(!(Test-Path $p)){ Fail "Missing file: $p" }
  [System.IO.File]::ReadAllText($p,[System.Text.UTF8Encoding]::new($false))
}
function Write-Utf8NoBom($p,$t){
  [System.IO.File]::WriteAllText($p,$t,[System.Text.UTF8Encoding]::new($false))
}
function Backup($p){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$p.bak.$ts"
  Copy-Item -Force $p $bak
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$targetRel = "components\ui\button.tsx"
$target = Join-Path $root $targetRel
if(!(Test-Path $target)){ Fail "Not found: $targetRel" }

Backup $target
$t = Read-Utf8NoBom $target

# Idempotency
if($t -match "PHASE P1E\.1 BUTTON CURSOR NOT ALLOWED" -or $t -match "disabled:cursor-not-allowed"){
  Write-Host "[OK] P1E.1 cursor patch already present (skip)"
  Write-Utf8NoBom $target $t
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

$from = "disabled:pointer-events-none"
$to   = "disabled:cursor-not-allowed /* PHASE P1E.1 BUTTON CURSOR NOT ALLOWED */"

$pos = $t.IndexOf($from)
if($pos -lt 0){
  Fail "Could not find '$from' in $targetRel. (Your file may already be changed or differs.)"
}

# Replace first occurrence only (safe)
$t2 = $t.Substring(0,$pos) + $to + $t.Substring($pos + $from.Length)

Write-Utf8NoBom $target $t2
Write-Host "[OK] Patched: $targetRel"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
