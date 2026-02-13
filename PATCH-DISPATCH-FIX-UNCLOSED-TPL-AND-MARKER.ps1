# PATCH-DISPATCH-FIX-UNCLOSED-TPL-AND-MARKER.ps1
# Fixes:
# 1) querySelector template literal -> string concat (removes backticks)
# 2) "/* ... */const" marker merge -> newline after marker
# Only touches: app\dispatch\page.tsx
# Creates a timestamped backup automatically.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

$path = "app\dispatch\page.tsx"
if (-not (Test-Path $path)) { Fail "Missing file: $path" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item -Force $path $bak
Ok "Backup: $bak"

# Read file
$txt = Get-Content -Raw -Encoding UTF8 $path
$orig = $txt

# --- Fix #1: querySelector(`[data-booking-id="${focusBookingId}"]`);
# Replace with: querySelector('[data-booking-id="' + focusBookingId + '"]');
# We handle whitespace variations but require focusBookingId inside.
$rxQselTpl = 'document\.querySelector\(\s*`?\[data-booking-id="\$\{focusBookingId\}"\]`?\s*\)'
# The above is too strict for real code; use a safer pattern that matches the exact line form:
$rxQselLine = 'document\.querySelector\(\s*`?\[data-booking-id="\$\{focusBookingId\}"\]`?\s*\)'

# Better: match the full selector string inside backticks: `[data-booking-id="${focusBookingId}"]`
$rxQselFull = 'document\.querySelector\(\s*`?\[data-booking-id="\$\{focusBookingId\}"\]`?\s*\)'

# In practice your line is:
# document.querySelector(`[data-booking-id="${focusBookingId}"]`);
# We'll match that exact structure (with optional spaces) reliably:
$rxExact = 'document\.querySelector\(\s*`\[data-booking-id="\$\{focusBookingId\}"\]`\s*\)'

if ($txt -match $rxExact) {
  $txt = [regex]::Replace(
    $txt,
    $rxExact,
    'document.querySelector(''[data-booking-id="'' + focusBookingId + ''"]'')'
  )
  Ok "Fixed querySelector template literal -> string concat (no backticks)."
} else {
  # Fallback: if stray backtick corruption exists, match a broader but still safe pattern:
  $rxBroad = 'document\.querySelector\(\s*`?\[data-booking-id="\$\{focusBookingId\}"\]`?\s*\)'
  if ($txt -match $rxBroad) {
    $txt = [regex]::Replace(
      $txt,
      $rxBroad,
      'document.querySelector(''[data-booking-id="'' + focusBookingId + ''"]'')'
    )
    Ok "Fixed querySelector (broad match) -> string concat (no backticks)."
  } else {
    Warn "Did not find the querySelector template literal pattern. No change for fix #1."
  }
}

# --- Fix #2: Marker merge: /* JRIDE_UI_SEARCH_V2_END */const missingCountUi = ...
# Force newline after the marker if immediately followed by 'const'
$rxMarkerMerge = '(?m)(/\*\s*JRIDE_UI_SEARCH_V2_END\s*\*/)\s*(const\s+missingCountUi\s*=)'
if ($txt -match $rxMarkerMerge) {
  $txt = [regex]::Replace($txt, $rxMarkerMerge, "`$1`r`n`$2")
  Ok "Split JRIDE_UI_SEARCH_V2_END marker onto its own line."
} else {
  Warn "Did not find marker-merge pattern for JRIDE_UI_SEARCH_V2_END. No change for fix #2."
}

# Safety: if no change, abort (so we don't create meaningless commits)
if ($txt -eq $orig) {
  Fail "No changes were made. Aborting so we don't drift. (File may already be fixed or patterns differ.)"
}

# Write file back
Set-Content -Encoding UTF8 -NoNewline -Path $path -Value $txt
Ok "Wrote patched file: $path"

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "npm.cmd run build" -ForegroundColor Cyan
