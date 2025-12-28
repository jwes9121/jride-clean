# FIX-JRIDE_PHASE7C_SYNTAX_RECOVERY_LIVETRIPSCLIENT_V3.ps1
# Phase 7C: Syntax recovery only (NO REGEX, NO MASS REPLACE)
# Removes ONLY punctuation-only debris between optimisticStatus() end and loadPage() start.

$ErrorActionPreference = "Stop"

function Fail($m) { throw "[FAIL] $m" }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

$relPath = "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $relPath)) { Fail "File not found: $relPath (run from repo root)." }

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$relPath.bak.$stamp"
Copy-Item -LiteralPath $relPath -Destination $bak -Force
Ok "Backup: $bak"

# Read as lines (preserve order)
$lines = Get-Content -LiteralPath $relPath

# --- Helper: check if a line contains any "real code" characters ---
# We consider letters/digits/underscore/quotes/backticks/slashes as "real"
function IsJunkOnlyLine([string]$line) {
  if ($null -eq $line) { return $true }
  $t = $line.Trim()
  if ($t.Length -eq 0) { return $true } # blank is ok

  for ($i=0; $i -lt $t.Length; $i++) {
    $ch = $t[$i]

    # Letters
    if (($ch -ge 'A' -and $ch -le 'Z') -or ($ch -ge 'a' -and $ch -le 'z')) { return $false }
    # Digits
    if ($ch -ge '0' -and $ch -le '9') { return $false }
    # Underscore (common in identifiers)
    if ($ch -eq '_') { return $false }
    # Quotes/backticks/slashes (strings/comments/paths)
    if ($ch -eq '"' -or $ch -eq "'" -or $ch -eq '`' -or $ch -eq '/' -or $ch -eq '\') { return $false }
  }

  # If we got here, the trimmed line has only punctuation/symbols like : ) ; } etc.
  return $true
}

# --- Step 1: find optimisticStatus start line ---
$start = -1
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i].Contains("function optimisticStatus")) { $start = $i; break }
}
if ($start -lt 0) { Fail "Could not find 'function optimisticStatus'." }

# --- Step 2: brace-count to find its true closing brace line index ---
$brace = 0
$foundOpen = $false
$end = -1

for ($i=$start; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]
  for ($j=0; $j -lt $line.Length; $j++) {
    $c = $line[$j]
    if ($c -eq '{') { $brace++; $foundOpen = $true }
    elseif ($c -eq '}') { $brace-- }
  }
  if ($foundOpen -and $brace -eq 0) { $end = $i; break }
}
if ($end -lt 0) { Fail "Could not find the closing brace for optimisticStatus() (brace count never returned to 0)." }

# --- Step 3: find the next 'async function loadPage' after optimisticStatus ---
$loadPage = -1
for ($i=$end+1; $i -lt $lines.Count; $i++) {
  if ($lines[$i].Contains("async function loadPage")) { $loadPage = $i; break }
}
if ($loadPage -lt 0) { Fail "Could not find 'async function loadPage' after optimisticStatus()." }

# --- Step 4: inspect the in-between region, remove it ONLY if it's junk-only ---
$betweenStart = $end + 1
$betweenEnd = $loadPage - 1

$junkOnly = $true
for ($i=$betweenStart; $i -le $betweenEnd; $i++) {
  if (-not (IsJunkOnlyLine $lines[$i])) {
    $junkOnly = $false
    break
  }
}

$changed = $false

if ($betweenEnd -ge $betweenStart) {
  if ($junkOnly) {
    # Remove the entire junk-only region
    $before = @()
    if ($betweenStart -gt 0) { $before = $lines[0..($betweenStart-1)] }
    $after = $lines[$loadPage..($lines.Count-1)]
    $lines = @($before + $after)
    $changed = $true
    Ok "Removed punctuation-only debris block between optimisticStatus() and loadPage()."
  } else {
    Fail "Between optimisticStatus() and loadPage() there is non-junk content (letters/digits/quotes). Refusing to delete."
  }
} else {
  Warn "No lines exist between optimisticStatus() and loadPage(). Nothing to remove there."
}

# --- Step 5: fix '}const id = normTripId(t);' join if present (line-based, no regex) ---
for ($i=0; $i -lt $lines.Count; $i++) {
  $idx = $lines[$i].IndexOf("}const id = normTripId(t);")
  if ($idx -ge 0) {
    $lines[$i] = $lines[$i].Replace("}const id = normTripId(t);", "}`r`n`r`nconst id = normTripId(t);")
    $changed = $true
    Ok "Fixed missing newline before const id in visibleTrips.map."
    break
  }
}

if (-not $changed) {
  Fail "No changes were applied (targets not found or already clean)."
}

# --- Write back ---
Set-Content -LiteralPath $relPath -Value $lines -Encoding UTF8
Ok "Wrote patched file: $relPath"
