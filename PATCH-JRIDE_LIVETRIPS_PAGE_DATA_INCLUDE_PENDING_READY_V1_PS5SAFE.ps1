param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

Info "== PATCH: LiveTrips page-data should include pending + ready (V1 / PS5-safe) =="
Info "Repo: $ProjRoot"

# --- Find the page-data route by its debug signature ---
$targets = @()
try {
  $targets = Get-ChildItem -LiteralPath $ProjRoot -Recurse -File -Filter "route.ts" -ErrorAction Stop |
    Where-Object { $_.FullName -match "livetrips" } |
    ForEach-Object { $_.FullName }
} catch {
  Fail "[FAIL] Could not enumerate route.ts files. $($_.Exception.Message)"
}

if ($targets.Count -eq 0) {
  Fail "[FAIL] No route.ts files found under repo. Is this a Next.js app dir layout?"
}

$matchFile = $null
foreach ($f in $targets) {
  try {
    $c = Get-Content -LiteralPath $f -Raw -Encoding UTF8
    if ($c -match "injected_active_statuses") {
      $matchFile = $f
      break
    }
  } catch {}
}

if (!$matchFile) {
  # fallback: search anywhere (not only route.ts) for injected_active_statuses
  $scan = Get-ChildItem -LiteralPath $ProjRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "\.(ts|tsx|js)$" } |
    ForEach-Object { $_.FullName }

  foreach ($f in $scan) {
    try {
      $c = Get-Content -LiteralPath $f -Raw -Encoding UTF8
      if ($c -match "injected_active_statuses") {
        $matchFile = $f
        break
      }
    } catch {}
  }
}

if (!$matchFile) {
  Fail "[FAIL] Could not find file containing 'injected_active_statuses'. Paste your app/api/admin/livetrips/page-data/route.ts if custom."
}

Info "Target: $matchFile"

# --- Backup ---
$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("livetrips-page-data.route.ts.bak.PENDING_READY_V1.$stamp")
Copy-Item -LiteralPath $matchFile -Destination $bak -Force
Ok "[OK] Backup: $bak"

# --- Patch content ---
$src = Get-Content -LiteralPath $matchFile -Raw -Encoding UTF8

# Strategy:
# 1) Find an array literal that includes assigned + on_the_way + arrived + enroute + on_trip (like your debug output)
# 2) Insert pending + ready if missing
#
# We patch the FIRST matching array only to avoid unintended edits elsewhere.

$patched = $src
$did = $false

# Regex to capture array content that includes assigned and on_the_way and on_trip (order can vary)
$re = [regex]'(?s)(\[\s*(?:"[^"]+"\s*,\s*)*"assigned"\s*,\s*(?:"[^"]+"\s*,\s*)*"on_the_way"\s*,\s*(?:"[^"]+"\s*,\s*)*"on_trip"(?:\s*,\s*"[^"]+")*\s*\])'

$m = $re.Match($patched)
if ($m.Success) {
  $arr = $m.Groups[1].Value

  # normalize tokens for checks
  $lower = $arr.ToLowerInvariant()

  $needPending = ($lower -notmatch '"pending"')
  $needReady   = ($lower -notmatch '"ready"')

  if ($needPending -or $needReady) {
    # Insert pending/ready near the front, after "[" or after "requested" if present
    if ($lower -match '"requested"') {
      # after requested
      $arr2 = $arr -replace '(?s)("requested"\s*,)', ('$1' + ($(if($needPending){' "pending",'}else{''}) + $(if($needReady){' "ready",'}else{''})))
    } else {
      # after opening bracket
      $insert = ""
      if ($needPending) { $insert += ' "pending",' }
      if ($needReady)   { $insert += ' "ready",' }
      $arr2 = $arr -replace '^\[\s*', ('[' + $insert + ' ')
    }

    $patched = $patched.Substring(0, $m.Index) + $arr2 + $patched.Substring($m.Index + $m.Length)
    $did = $true
  }
}

if (-not $did) {
  # Fallback patch: directly patch the injected_active_statuses debug object if it’s built as an array literal
  # (This catches cases where the status list is defined near the debug response)
  $re2 = [regex]'(?s)("injected_active_statuses"\s*:\s*)(\[[^\]]+\])'
  $m2 = $re2.Match($patched)
  if ($m2.Success) {
    $prefix = $m2.Groups[1].Value
    $arr = $m2.Groups[2].Value
    $lower = $arr.ToLowerInvariant()

    $needPending = ($lower -notmatch '"pending"')
    $needReady   = ($lower -notmatch '"ready"')

    if ($needPending -or $needReady) {
      $insert = ""
      if ($needPending) { $insert += ' "pending",' }
      if ($needReady)   { $insert += ' "ready",' }
      $arr2 = $arr -replace '^\[\s*', ('[' + $insert + ' ')
      $patched = $re2.Replace($patched, ($prefix + $arr2), 1)
      $did = $true
    }
  }
}

if (-not $did) {
  Fail "[FAIL] Could not locate the active statuses array to patch. Open the target file and search for the statuses list; it may be constructed dynamically."
}

# Write back (UTF-8 no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($matchFile, $patched, $utf8NoBom)
Ok "[OK] Patched active statuses to include pending + ready"

Info "Next: redeploy / rebuild and recheck:"
Info "  https://app.jride.net/api/admin/livetrips/page-data?debug=1"
Info "Expected injected_active_statuses includes pending + ready"
