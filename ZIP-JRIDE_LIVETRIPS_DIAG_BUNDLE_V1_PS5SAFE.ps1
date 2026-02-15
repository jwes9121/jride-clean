param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot,

  [Parameter(Mandatory=$false)]
  [string]$OutZip = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path.TrimEnd("\","/")

$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
if ([string]::IsNullOrWhiteSpace($OutZip)) {
  $OutZip = Join-Path $ProjRoot ("JRIDE_LIVETRIPS_DIAG_BUNDLE_V1_{0}.zip" -f $stamp)
} else {
  $OutZip = (Resolve-Path -LiteralPath (Split-Path -Parent $OutZip) -ErrorAction SilentlyContinue).Path + "\" + (Split-Path -Leaf $OutZip)
}

Info "== JRIDE: Zip LiveTrips diagnostic bundle (V1 / PS5-safe) =="
Info "Repo:   $ProjRoot"
Info "OutZip: $OutZip"

# Build a list of desired relative paths (exact)
$wantedRel = @(
  "app\admin\livetrips\LiveTripsClient.tsx",
  "app\admin\livetrips\LiveTripsMap.tsx",
  "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx",
  "app\api\admin\livetrips\page-data\route.ts",
  "app\api\dispatch\assign\route.ts",
  "app\api\dispatch\status\route.ts"
)

# Optional: search these anywhere under app/
$optionalNames = @("TripWalletPanel.tsx", "TripLifecycleActions.tsx")

$files = New-Object System.Collections.Generic.List[string]

foreach ($rel in $wantedRel) {
  $full = Join-Path $ProjRoot $rel
  if (Test-Path -LiteralPath $full) {
    $files.Add($full) | Out-Null
    Ok "[OK] Add: $rel"
  } else {
    Warn "[MISS] $rel"
  }
}

# Optional file discovery
foreach ($name in $optionalNames) {
  $found = @()
  try {
    $found = Get-ChildItem -LiteralPath (Join-Path $ProjRoot "app") -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ieq $name } |
      Select-Object -ExpandProperty FullName
  } catch {}

  if ($found.Count -gt 0) {
    foreach ($f in $found) {
      $files.Add($f) | Out-Null
      Ok "[OK] Add optional: $($f.Substring($ProjRoot.Length + 1))"
    }
  } else {
    Warn "[MISS optional] $name"
  }
}

if ($files.Count -eq 0) {
  Fail "[FAIL] No files found to zip. Check ProjRoot and paths."
}

# Create staging folder to preserve relative paths
$stage = Join-Path $env:TEMP ("jride_diag_stage_{0}" -f $stamp)
New-Item -ItemType Directory -Path $stage | Out-Null
Info "Stage: $stage"

foreach ($full in $files) {
  $rel = $full.Substring($ProjRoot.Length).TrimStart("\","/")
  $dest = Join-Path $stage $rel
  $destDir = Split-Path -Parent $dest
  if (!(Test-Path -LiteralPath $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  }
  Copy-Item -LiteralPath $full -Destination $dest -Force
}

# Remove existing zip if present
if (Test-Path -LiteralPath $OutZip) {
  Remove-Item -LiteralPath $OutZip -Force
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $OutZip -CompressionLevel Optimal
Ok "[OK] Created ZIP: $OutZip"

# Cleanup stage
try {
  Remove-Item -LiteralPath $stage -Recurse -Force
  Ok "[OK] Cleaned staging folder"
} catch {
  Warn "[WARN] Could not remove stage folder: $stage"
}

Info "Done."
