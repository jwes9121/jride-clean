$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

# Repo root is current folder
$root = (Get-Location).Path
Write-Host "[1/4] Repo root: $root" -ForegroundColor Cyan

# 1) Prefer exact filename, anywhere in repo
Write-Host "[2/4] Searching for RUN-TAKEOUT-EXPRESS-E2E.ps1 ..." -ForegroundColor Cyan
$targets = Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ieq "RUN-TAKEOUT-EXPRESS-E2E.ps1" }

# 2) If not found, search for the actual PS5-breaking token "?.trips" in any .ps1
if (-not $targets -or $targets.Count -eq 0) {
  Write-Host "[2/4] Exact name not found. Searching for '?.trips' inside *.ps1 files ..." -ForegroundColor Yellow

  $ps1s = Get-ChildItem -Path $root -Recurse -File -Filter "*.ps1" -ErrorAction SilentlyContinue
  $hits = @()

  foreach ($f in $ps1s) {
    try {
      $raw = Get-Content $f.FullName -Raw -ErrorAction Stop
      if ($raw -match '\?\.\s*trips') {
        $hits += $f
      }
    } catch {
      # ignore unreadable files
    }
  }

  $targets = $hits
}

if (-not $targets -or $targets.Count -eq 0) {
  Fail "Could not find any .ps1 containing '?.trips' and also could not find RUN-TAKEOUT-EXPRESS-E2E.ps1 anywhere under: $root"
}

Write-Host "[FOUND] Candidate files:" -ForegroundColor Green
$targets | ForEach-Object { Write-Host " - $($_.FullName)" }

# Patch logic: remove the optional chaining reference "$pd.data?.trips" safely.
# We support both the exact block and a flexible regex.
$oldBlock = @'
if (-not $trips) {
  # sometimes api returns {ok:true, ...}
  $trips = $pd.data?.trips
}
'@

$newBlock = @'
if (-not $trips) {
  # sometimes api returns {ok:true, ...} in a nested "data" object
  if ($pd -and ($pd.PSObject.Properties.Name -contains "data") -and $pd.data) {
    if ($pd.data.PSObject.Properties.Name -contains "trips") {
      $trips = $pd.data.trips
    }
  }
}
'@

$rx = '(?ms)if\s*\(\s*-not\s+\$trips\s*\)\s*\{\s*#\s*sometimes\s+api\s+returns\s+\{ok:true,\s*\.\.\.\}\s*\r?\n\s*\$trips\s*=\s*\$pd\.data\?\.\s*trips\s*\r?\n\s*\}'

$patchedAny = $false

Write-Host "[3/4] Applying PS5 fix (remove ?. optional chaining) ..." -ForegroundColor Cyan

foreach ($file in $targets) {
  $path = $file.FullName
  $txt = Get-Content $path -Raw

  if (($txt -notmatch '\?\.\s*trips') -and ($txt -notmatch '\$pd\.data\?\.\s*trips')) {
    Write-Host "[SKIP] No '?.trips' found in: $path" -ForegroundColor DarkGray
    continue
  }

  # Backup
  $bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak" -ForegroundColor Green

  $before = $txt

  # First try exact replace
  if ($txt -like "*$($oldBlock.Replace("`r`n","`n"))*") {
    $txt = $txt.Replace($oldBlock, $newBlock)
  } else {
    # Then try flexible regex replace
    if ($txt -match $rx) {
      $txt = [regex]::Replace($txt, $rx, $newBlock)
    } else {
      # Last resort: replace JUST the expression '$pd.data?.trips' to '$pd.data.trips' guarded
      # We do not want to break logic, so only do this if we can also see "$pd.data?.trips" literally.
      if ($txt -match '\$pd\.data\?\.\s*trips') {
        $txt = $txt -replace '\$pd\.data\?\.\s*trips', '($pd.data.trips)'
      } else {
        Write-Host "[WARN] Could not match expected block pattern in: $path" -ForegroundColor Yellow
        continue
      }
    }
  }

  if ($txt -eq $before) {
    Write-Host "[WARN] No changes applied to: $path (pattern mismatch)" -ForegroundColor Yellow
    continue
  }

  # Sanity: ensure we removed ?.trips
  if ($txt -match '\?\.\s*trips') {
    Fail "Sanity failed: still found '?.trips' after patch in: $path"
  }

  Set-Content -Path $path -Value $txt -Encoding UTF8
  Write-Host "[DONE] Patched: $path" -ForegroundColor Green
  $patchedAny = $true
}

if (-not $patchedAny) {
  Fail "No files were patched. Either the script isn't in this repo folder, or the pattern is different. Paste the exact line that contains '?.trips' from your failing script."
}

Write-Host "[4/4] Finished. Re-run your E2E script now." -ForegroundColor Cyan
