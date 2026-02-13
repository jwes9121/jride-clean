$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ throw $m }

$path = Join-Path (Get-Location) "app\api\admin\livetrips\page-data\route.ts"
if (!(Test-Path $path)) { Fail "Missing: $path (run from repo root)" }

$txt = Get-Content -LiteralPath $path -Raw

if ($txt -match "PHASE3C2_INCLUDE_REQUESTED_ACTIVE_STATUSES") {
  Ok "[OK] Patch already applied. No changes made."
  exit 0
}

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $bak"

# Find the ACTIVE_STATUSES const (as seen in your output)
$needle = 'const ACTIVE_STATUSES = ["assigned", "on_the_way", "arrived", "enroute", "on_trip"];'
if ($txt.Contains($needle)) {
  $replacement = 'const ACTIVE_STATUSES = ["requested", "assigned", "on_the_way", "arrived", "enroute", "on_trip"]; /* PHASE3C2_INCLUDE_REQUESTED_ACTIVE_STATUSES */'
  $txt2 = $txt.Replace($needle, $replacement)
} else {
  # Tolerant fallback: locate the line containing "const ACTIVE_STATUSES" and inject if it’s an array
  $lines = Get-Content -LiteralPath $path
  $idx = -1
  for ($i=0; $i -lt $lines.Count; $i++){
    if ($lines[$i].Contains("const ACTIVE_STATUSES")) { $idx = $i; break }
  }
  if ($idx -lt 0) { Fail "Could not find 'const ACTIVE_STATUSES' in $path" }

  $line = $lines[$idx]

  if ($line -match "requested") {
    Ok "[OK] ACTIVE_STATUSES already mentions requested. No edit needed."
    exit 0
  }

  # Only patch if it's an array literal on same line
  if ($line -notmatch "\[.*\]") {
    Fail "Found const ACTIVE_STATUSES but not an inline array literal. Paste that section."
  }

  # Insert requested after '['
  $pos = $line.IndexOf("[")
  if ($pos -lt 0) { Fail "Could not locate '[' in ACTIVE_STATUSES line." }

  $before = $line.Substring(0, $pos+1)
  $after  = $line.Substring($pos+1)

  # Keep quote style of existing first element
  $injected = $before + '"requested", ' + $after + " /* PHASE3C2_INCLUDE_REQUESTED_ACTIVE_STATUSES */"
  $lines[$idx] = $injected

  $txt2 = ($lines -join "`r`n")
}

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt2, $utf8)

Ok "[OK] Patched ACTIVE_STATUSES to include 'requested'."
Ok "[NEXT] npm run build, deploy, then create a new takeout order and confirm it shows in /admin/livetrips."
