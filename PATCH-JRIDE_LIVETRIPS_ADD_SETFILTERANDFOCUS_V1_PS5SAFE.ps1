param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Info([string]$m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }

function Get-Timestamp() { (Get-Date).ToString("yyyyMMdd_HHmmss") }

function Read-Utf8NoBom([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { Fail "Missing file: $path" }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    if ($bytes.Length -eq 3) { return "" }
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-Utf8NoBom([string]$path, [string]$text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

function Backup-File([string]$path, [string]$tag, [string]$root) {
  $bakDir = Join-Path $root "_patch_bak"
  if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $ts = Get-Timestamp
  $leaf = Split-Path -Leaf $path
  $bak = Join-Path $bakDir ($leaf + ".bak." + $tag + "." + $ts)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok ("Backup: " + $bak)
}

# ----------------------------
# Resolve repo + target file
# ----------------------------
$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path
Info "== PATCH: Add setFilterAndFocus() helper to LiveTripsClient (V1 / PS5-safe) =="
Info "Repo: $ProjRoot"

$clientPath = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path -LiteralPath $clientPath)) { Fail "Cannot find: $clientPath" }

$orig = Read-Utf8NoBom $clientPath
Backup-File $clientPath "LIVETRIPS_ADD_SETFILTERANDFOCUS_V1" $ProjRoot
$txt = $orig

# If already present, do nothing
if ($txt -match "(?m)^\s*(const|function)\s+setFilterAndFocus\b") {
  Ok "setFilterAndFocus already exists. No changes made."
  exit 0
}

# Detect likely selection setters (optional clears)
$hasSetSelectedBookingCode = ($txt -match "\bsetSelectedBookingCode\s*\(")
$hasSetSelectedTrip        = ($txt -match "\bsetSelectedTrip\s*\(")
$hasSetActiveBookingCode   = ($txt -match "\bsetActiveBookingCode\s*\(")
$hasSetSelected            = ($txt -match "\bsetSelected\s*\(")

# Build insert block (TypeScript)
$nl = "`r`n"
$insert = ""
$insert += $nl
$insert += "  // Helper used by tab buttons (dispatch/pending/etc.)" + $nl
$insert += "  // Keeps build-safe even if some selection state isn't present." + $nl
$insert += "  const setFilterAndFocus = (next: any) => {" + $nl
$insert += "    try {" + $nl
$insert += "      setTripFilter(next as any);" + $nl

# Optional clears ONLY if we see those setters in the file (so we don't introduce new undefined names)
if ($hasSetSelectedBookingCode) { $insert += "      setSelectedBookingCode(null as any);" + $nl }
if ($hasSetSelectedTrip)        { $insert += "      setSelectedTrip(null as any);" + $nl }
if ($hasSetActiveBookingCode)   { $insert += "      setActiveBookingCode(null as any);" + $nl }
if ($hasSetSelected)            { $insert += "      setSelected(null as any);" + $nl }

$insert += "      // Scroll the left list into view after changing filter (non-fatal if DOM differs)" + $nl
$insert += "      if (typeof window !== 'undefined') {" + $nl
$insert += "        try { window.scrollTo({ top: 0, behavior: 'smooth' as any }); } catch (e) { window.scrollTo(0, 0); }" + $nl
$insert += "      }" + $nl
$insert += "    } catch (e) {" + $nl
$insert += "      // no-op" + $nl
$insert += "    }" + $nl
$insert += "  };" + $nl

# Insert location strategy:
# Prefer to insert AFTER pillClass helper if present (near tabs)
$rePill = [regex]::new("(?s)(\r?\n[ \t]*(const|function)\s+pillClass\b[^\r\n]*\r?\n)", [System.Text.RegularExpressions.RegexOptions]::Singleline)
if ($rePill.IsMatch($txt)) {
  $txt = $rePill.Replace($txt, "`$1" + $insert, 1)
  Write-Utf8NoBom $clientPath $txt
  Ok "Inserted setFilterAndFocus after pillClass helper."
} else {
  # Fallback: insert before the first "return (" inside the component
  $reReturn = [regex]::new("(?m)^\s*return\s*\(", [System.Text.RegularExpressions.RegexOptions]::Multiline)
  $m = $reReturn.Match($txt)
  if (-not $m.Success) {
    Fail "Could not find insertion point (no pillClass and no 'return(' found). Paste the top ~120 lines of LiveTripsClient.tsx so I can anchor precisely."
  }
  $idx = $m.Index
  $txt = $txt.Substring(0, $idx) + $insert + $txt.Substring($idx)
  Write-Utf8NoBom $clientPath $txt
  Ok "Inserted setFilterAndFocus before return(...)."
}

Write-Host ""
Write-Host "NEXT:" -ForegroundColor Yellow
Write-Host "1) npm.cmd run build" -ForegroundColor Yellow
Write-Host "2) Refresh https://app.jride.net/admin/livetrips" -ForegroundColor Yellow
Write-Host ""

Ok "DONE"