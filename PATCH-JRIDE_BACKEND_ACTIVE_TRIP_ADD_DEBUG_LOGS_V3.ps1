# PATCH-JRIDE_BACKEND_ACTIVE_TRIP_ADD_DEBUG_LOGS_V3.ps1
# Robust debug-log injector for: app/api/driver/active-trip/route.ts
#
# Why V3:
# - Your route.ts does NOT match the earlier ".from('bookings')" destructure pattern.
# - V3 instruments ANY "await supabase..." query (from/rpc/select) and ANY return that mentions NO_ACTIVE_TRIP.
#
# What it adds (TEMP):
# 1) After driverId/driver_id/did assignment: logs driver var and value.
# 2) After ANY "const { data, error } = await supabase ..." statement: logs error, type, length, keys of first row.
# 3) After ANY "const X = await supabase ..." statement: logs X (best-effort).
# 4) Before ANY return block that contains "NO_ACTIVE_TRIP": logs returning NO_ACTIVE_TRIP.
#
# Safety:
# - Creates backup
# - Won't double-insert (checks for [ACTIVE_TRIP_DEBUG])
# - Works even if query uses rpc/views/etc (not only bookings)

$ErrorActionPreference = "Stop"

function Read-Utf8NoBom([string]$path) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  return [System.IO.File]::ReadAllText($path, $enc)
}
function Write-Utf8NoBom([string]$path, [string]$content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

$root   = (Get-Location).Path
$target = Join-Path $root "app\api\driver\active-trip\route.ts"

if (!(Test-Path $target)) {
  throw ("Missing file: " + $target + "`nMake sure you are in repo root (jride-clean-fresh).")
}

# Backup
$backupDir = Join-Path $root "_patch_backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("app__api__driver__active-trip__route.ts.bak.$stamp")
Copy-Item -Force $target $backup
Write-Host "[OK] Backup: $backup" -ForegroundColor Green

$txt = Read-Utf8NoBom $target

if ($txt -match "\[ACTIVE_TRIP_DEBUG\]") {
  Write-Host "[OK] Debug logs already present. No changes applied." -ForegroundColor Green
  exit 0
}

$notes   = New-Object System.Collections.Generic.List[string]
$changed = $false

# ---------------------------
# 1) Log driver var after assignment
# ---------------------------
$patternDriverLine = "(?m)^(?<indent>\s*)(const|let)\s+(?<var>driverId|driver_id|did)\s*=\s*.*?;\s*$"
$mDriver = [regex]::Match($txt, $patternDriverLine)
if ($mDriver.Success) {
  $indent = $mDriver.Groups["indent"].Value
  $var    = $mDriver.Groups["var"].Value
  $insert = $indent + 'console.log("[ACTIVE_TRIP_DEBUG] driver var=' + $var + ' value=", ' + $var + ');'
  $pos = $mDriver.Index + $mDriver.Length
  $txt = $txt.Substring(0, $pos) + "`r`n" + $insert + "`r`n" + $txt.Substring($pos)
  $changed = $true
  $notes.Add("Inserted driver log after " + $var + " assignment.")
} else {
  $notes.Add("WARN: Could not find driverId/driver_id/did assignment line to log.")
}

# Helper: insert after index safely
function Insert-After([string]$s, [int]$idxAfter, [string]$insertText) {
  return $s.Substring(0, $idxAfter) + $insertText + $s.Substring($idxAfter)
}

# ---------------------------
# 2) Instrument ALL destructured Supabase awaits:
#    const { data, error } = await supabase ...
#    const { data: rows, error: err } = await supabase ...
# ---------------------------
$patternDestructure = "(?is)(?<indent>^\s*)const\s*\{\s*(?<dataKey>data(?:\s*:\s*\w+)?)\s*,\s*(?<errorKey>error(?:\s*:\s*\w+)?)\s*\}\s*=\s*await\s+supabase[\s\S]*?;\s*$"
$matches = [regex]::Matches($txt, $patternDestructure)

if ($matches.Count -gt 0) {
  # Insert from bottom to top so indexes don't shift
  for ($i = $matches.Count - 1; $i -ge 0; $i--) {
    $m = $matches[$i]
    $indent  = $m.Groups["indent"].Value
    $dataKey = $m.Groups["dataKey"].Value.Trim()
    $errKey  = $m.Groups["errorKey"].Value.Trim()

    $dataVar = "data"
    if ($dataKey -match "data\s*:\s*(\w+)") { $dataVar = $Matches[1] }

    $errVar = "error"
    if ($errKey -match "error\s*:\s*(\w+)") { $errVar = $Matches[1] }

    $logLines = @()
    $logLines += ($indent + 'console.log("[ACTIVE_TRIP_DEBUG] supabase error =", ' + $errVar + ');')
    $logLines += ($indent + 'console.log("[ACTIVE_TRIP_DEBUG] data type =", (Array.isArray(' + $dataVar + ') ? "array" : typeof ' + $dataVar + '));')
    $logLines += ($indent + 'console.log("[ACTIVE_TRIP_DEBUG] data length =", (Array.isArray(' + $dataVar + ') ? ' + $dataVar + '.length : null));')
    $logLines += ($indent + 'try {')
    $logLines += ($indent + '  if (Array.isArray(' + $dataVar + ') && ' + $dataVar + '.length > 0) {')
    $logLines += ($indent + '    console.log("[ACTIVE_TRIP_DEBUG] first row keys =", Object.keys(' + $dataVar + '[0] || {}));')
    $logLines += ($indent + '  } else if (' + $dataVar + ' && typeof ' + $dataVar + ' === "object") {')
    $logLines += ($indent + '    console.log("[ACTIVE_TRIP_DEBUG] object keys =", Object.keys(' + $dataVar + '));')
    $logLines += ($indent + '  }')
    $logLines += ($indent + '} catch (e) { console.log("[ACTIVE_TRIP_DEBUG] key dump failed", e); }')

    $logBlock = "`r`n" + ($logLines -join "`r`n") + "`r`n"

    $insertPos = $m.Index + $m.Length
    $txt = Insert-After $txt $insertPos $logBlock
    $changed = $true
  }

  $notes.Add("Instrumented " + $matches.Count + " destructured 'await supabase' statements.")
} else {
  $notes.Add("INFO: No destructured 'const { data, error } = await supabase ...' statements found.")
}

# ---------------------------
# 3) Instrument non-destructured supabase awaits:
#    const res = await supabase ...
#    let res = await supabase ...
# ---------------------------
$patternVarAwait = "(?m)^(?<indent>\s*)(const|let)\s+(?<var>[A-Za-z_]\w*)\s*=\s*await\s+supabase[\s\S]*?;\s*$"
$matches2 = [regex]::Matches($txt, $patternVarAwait)

if ($matches2.Count -gt 0) {
  for ($i = $matches2.Count - 1; $i -ge 0; $i--) {
    $m = $matches2[$i]
    $indent = $m.Groups["indent"].Value
    $var    = $m.Groups["var"].Value

    # Avoid logging driver var line if it happens to match this (rare)
    if ($var -in @("driverId","driver_id","did")) { continue }

    $log = "`r`n" + $indent + 'console.log("[ACTIVE_TRIP_DEBUG] supabase result var ' + $var + ' =", ' + $var + ');' + "`r`n"
    $insertPos = $m.Index + $m.Length
    $txt = Insert-After $txt $insertPos $log
    $changed = $true
  }
  $notes.Add("Instrumented " + $matches2.Count + " non-destructured 'await supabase' assignments.")
} else {
  $notes.Add("INFO: No non-destructured 'const X = await supabase ...' statements found.")
}

# ---------------------------
# 4) Log before NO_ACTIVE_TRIP returns (best-effort):
#    Insert a console.log on any return block containing NO_ACTIVE_TRIP
# ---------------------------
$patternNoTripReturnAny = "(?is)(?<indent>^\s*)return\s+NextResponse\.json\([\s\S]*?NO_ACTIVE_TRIP[\s\S]*?\)\s*;\s*$"
$matches3 = [regex]::Matches($txt, $patternNoTripReturnAny)

if ($matches3.Count -gt 0) {
  for ($i = $matches3.Count - 1; $i -ge 0; $i--) {
    $m = $matches3[$i]
    $indent = $m.Groups["indent"].Value
    $inject = $indent + 'console.log("[ACTIVE_TRIP_DEBUG] returning NO_ACTIVE_TRIP");' + "`r`n"
    $txt = $txt.Substring(0, $m.Index) + $inject + $txt.Substring($m.Index)
    $changed = $true
  }
  $notes.Add("Annotated " + $matches3.Count + " NO_ACTIVE_TRIP return(s).")
} else {
  # Some routes return Response.json(...) or NextResponse.json without the string in the return block
  # We still note it.
  $notes.Add("WARN: Could not find a NextResponse.json(...) return block containing NO_ACTIVE_TRIP.")
}

if (-not $changed) {
  Write-Host "[NO CHANGE] No suitable anchors found to patch. Paste/upload app/api/driver/active-trip/route.ts and I'll patch exact anchors." -ForegroundColor Red
  throw "No changes applied."
}

Write-Utf8NoBom $target $txt
Write-Host "[DONE] Patched: $target" -ForegroundColor Green
Write-Host ""
Write-Host "Patch notes:" -ForegroundColor Cyan
$notes | ForEach-Object { Write-Host (" - " + $_) }

Write-Host ""
Write-Host "NEXT (after push/deploy): Hit endpoint, then check Vercel logs for [ACTIVE_TRIP_DEBUG] lines:" -ForegroundColor Yellow
Write-Host "  GET /api/driver/active-trip?driver_id=00000000-0000-4000-8000-000000000001" -ForegroundColor Yellow
