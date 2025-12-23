$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
Write-Host "[1/4] Repo root: $root" -ForegroundColor Cyan

# We ONLY want to patch real runtime scripts, not patch scripts.
# So: exclude PATCH-*.ps1 and *.bak.* files.
Write-Host "[2/4] Searching for PS5-breaking token: `$pd.data?.trips (excluding PATCH-*.ps1) ..." -ForegroundColor Cyan

$ps1s = Get-ChildItem -Path $root -Recurse -File -Filter "*.ps1" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -notlike "PATCH-*.ps1" -and
    $_.Name -notlike "*.bak.*"
  }

$candidates = @()

foreach ($f in $ps1s) {
  try {
    $raw = Get-Content $f.FullName -Raw -ErrorAction Stop
    # Look for the *literal* bad usage (not regex strings):
    if ($raw -match '\$pd\.data\?\.\s*trips') {
      $candidates += $f
    }
  } catch {
    # ignore unreadable files
  }
}

if (-not $candidates -or $candidates.Count -eq 0) {
  Write-Host "[INFO] No files found containing `$pd.data?.trips." -ForegroundColor Yellow
  Write-Host "If your error shows a different optional-chaining token (?.something), paste that exact line and I’ll patch that token too." -ForegroundColor Yellow
  exit 0
}

Write-Host "[FOUND] Candidate file(s):" -ForegroundColor Green
$candidates | ForEach-Object { Write-Host " - $($_.FullName)" }

Write-Host "[3/4] Patching (replace `$pd.data?.trips with PS5-safe access) ..." -ForegroundColor Cyan

$patchedAny = $false

foreach ($file in $candidates) {
  $path = $file.FullName
  $txt  = Get-Content $path -Raw

  # Backup
  $bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak" -ForegroundColor Green

  # Replace the assignment line(s) safely:
  # any occurrence of $pd.data?.trips becomes a guarded expression
  $before = $txt

  $replacement = @'
(if ($pd -and ($pd.PSObject.Properties.Name -contains "data") -and $pd.data -and ($pd.data.PSObject.Properties.Name -contains "trips")) { $pd.data.trips } else { $null })
'@

  $txt = [regex]::Replace($txt, '\$pd\.data\?\.\s*trips', $replacement)

  if ($txt -eq $before) {
    Write-Host "[WARN] No change applied (pattern mismatch) in: $path" -ForegroundColor Yellow
    continue
  }

  # Sanity: ensure the bad token is gone
  if ($txt -match '\$pd\.data\?\.\s*trips') {
    Fail "Sanity failed: still found `$pd.data?.trips after patch in: $path"
  }

  Set-Content -Path $path -Value $txt -Encoding UTF8
  Write-Host "[DONE] Patched: $path" -ForegroundColor Green
  $patchedAny = $true
}

if (-not $patchedAny) {
  Fail "No files were patched (unexpected)."
}

Write-Host "[4/4] Finished. Re-run your RUN-TAKEOUT-EXPRESS-E2E script." -ForegroundColor Cyan
