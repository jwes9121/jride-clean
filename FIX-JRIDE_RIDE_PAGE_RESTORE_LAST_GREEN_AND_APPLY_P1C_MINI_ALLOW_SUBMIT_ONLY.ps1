# FIX-JRIDE_RIDE_PAGE_RESTORE_LAST_GREEN_AND_APPLY_P1C_MINI_ALLOW_SUBMIT_ONLY.ps1
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES
# Restores the most recent known-good backup (pre_p1c_v3 or pre_fix_writeback),
# then applies a SAFE P1C_MINI guardrail by tightening allowSubmit ONLY.
# No JSX insertion. No button-tag mutation.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Read-Utf8NoBom($path){
  if(!(Test-Path $path)){ Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
}
function Write-Utf8NoBom($path,$text){
  [System.IO.File]::WriteAllText($path,$text,[System.Text.UTF8Encoding]::new($false))
}
function Backup-File($path,$suffix){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$path.$suffix.$ts"
  Copy-Item -Force $path $bak
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path $target)){ Fail "Not found: $target" }

# Safety backup of current broken file
Backup-File $target "pre_restore_last_green"

# Find the newest "known good" backup created before the broken P1C attempts.
# Priority order:
#  1) .pre_p1c_v3.*   (created right before the V3 patch)
#  2) .pre_fix_writeback.* (created by the cleanup writer)
#  3) .pre_fix_remove_p1c.* (created before cleanup)
#  4) .bak.* (older general backups)
$cands = @()

$cands += Get-ChildItem -Path ($target + ".pre_p1c_v3.*") -ErrorAction SilentlyContinue
$cands += Get-ChildItem -Path ($target + ".pre_fix_writeback.*") -ErrorAction SilentlyContinue
$cands += Get-ChildItem -Path ($target + ".pre_fix_remove_p1c.*") -ErrorAction SilentlyContinue
$cands += Get-ChildItem -Path ($target + ".bak.*") -ErrorAction SilentlyContinue

if(!$cands -or $cands.Count -lt 1){
  Fail "No backups found for app\ride\page.tsx (expected .pre_p1c_v3.* or .pre_fix_writeback.* or .bak.*)."
}

$latest = $cands | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item -Force $latest.FullName $target
Write-Host "[OK] Restored from: $($latest.FullName)"

$t = Read-Utf8NoBom $target

# Idempotency marker
if($t.IndexOf("PHASE P1C_MINI: allowSubmit lock (UI-only)") -ge 0){
  Write-Host "[OK] P1C_MINI already applied (skip)"
  Write-Utf8NoBom $target $t
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

# Require p5OverrideStatus (debug_status override) so P1C works with debug preview too
if($t.IndexOf("function p5OverrideStatus") -lt 0){
  Fail "Missing function p5OverrideStatus. This restored backup is older than PHASE P5."
}

# Tighten allowSubmit safely:
# Replace the FIRST occurrence of 'geoOrLocalOk;' after 'const allowSubmit =' with:
# geoOrLocalOk && !["requested","assigned","on_the_way","arrived","on_trip"].includes(String(p5OverrideStatus(liveStatus)||"").trim().toLowerCase());
$posAllow = $t.IndexOf("const allowSubmit =")
if($posAllow -lt 0){ Fail "Could not find 'const allowSubmit ='." }

$needle = "geoOrLocalOk;"
$posNeedle = $t.IndexOf($needle, $posAllow)
if($posNeedle -lt 0){ Fail "Could not find 'geoOrLocalOk;' near allowSubmit." }

$guard = 'geoOrLocalOk && !["requested","assigned","on_the_way","arrived","on_trip"].includes(String(p5OverrideStatus(liveStatus)||"").trim().toLowerCase());'

$t = $t.Substring(0,$posNeedle) + $guard + $t.Substring($posNeedle + $needle.Length)

# Add a tiny comment marker right above allowSubmit line (safe)
# Insert immediately before the line containing 'const allowSubmit ='
$lineStart = $t.LastIndexOf("`n", $posAllow)
if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart = $lineStart + 1 }

$marker = "  // PHASE P1C_MINI: allowSubmit lock (UI-only)`n"
$t = $t.Substring(0,$lineStart) + $marker + $t.Substring($lineStart)

Write-Utf8NoBom $target $t
Write-Host "[OK] Applied P1C_MINI allowSubmit lock."
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
