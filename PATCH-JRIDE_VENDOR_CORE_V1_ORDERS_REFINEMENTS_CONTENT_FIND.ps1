# PATCH-JRIDE_VENDOR_CORE_V1_ORDERS_REFINEMENTS_CONTENT_FIND.ps1
# Vendor Core V1 refinements (no gating)
# Auto-locate vendor orders page by searching for the vendor orders API usage in TSX files
# One file only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

# 1) Find candidate TSX files that look like the vendor orders page
$root = Join-Path (Get-Location).Path "app"
if (!(Test-Path $root)) { Fail "Could not find ./app folder. Run from repo root." }

$patterns = @(
  "/api/vendor-orders",
  "vendor-orders",
  "vendor_status",
  "Vendor orders",
  "updateVendorStatus"
)

$tsx = Get-ChildItem -Recurse -File -Path $root -Include *.tsx,*.ts -ErrorAction SilentlyContinue

# Score each file by number of pattern hits
$candidates = @()
foreach ($f in $tsx) {
  $content = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
  if (-not $content) { continue }

  $score = 0
  foreach ($p in $patterns) {
    if ($content -match [regex]::Escape($p)) { $score++ }
  }

  # Must at least mention vendor-orders somewhere to qualify
  if ($content -match "vendor-orders" -or $content -match "/api/vendor-orders") {
    $candidates += [pscustomobject]@{ Path=$f.FullName; Score=$score }
  }
}

if ($candidates.Count -eq 0) {
  Fail "No TSX/TS files found referencing vendor-orders or /api/vendor-orders under ./app. Paste the exact API string used in the vendor page (e.g., /api/xyz) so we can search for it."
}

# Pick best-scoring file
$best = $candidates | Sort-Object Score -Descending | Select-Object -First 1

# If there are ties with the same score, list them to avoid patching wrong file
$topScore = $best.Score
$tied = $candidates | Where-Object { $_.Score -eq $topScore }
if ($tied.Count -gt 1) {
  Write-Host "Multiple candidate files found with the same match score ($topScore). Paste this list and I will target exactly one." -ForegroundColor Yellow
  $tied | Sort-Object Path | ForEach-Object { Write-Host ("- " + $_.Path) }
  Fail "Ambiguous vendor orders page."
}

$path = $best.Path
Ok "Target: $path (score=$($best.Score))"

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

if ($txt -match "VENDOR_CORE_V1_REFINEMENTS") {
  Info "Vendor Core V1 refinements already present. No change."
  exit 0
}

# ------------------------------------------------------------
# A) Insert updatingIdRef after updatingId state
# ------------------------------------------------------------
$updatingLinePat = '(?m)^\s*const\s*\[\s*updatingId\s*,\s*setUpdatingId\s*\]\s*=\s*useState<\s*string\s*\|\s*null\s*>\(\s*null\s*\);\s*$'
if ($txt -notmatch $updatingLinePat) { Fail "Could not find updatingId state line in target file." }

$refInsert = @'

  // VENDOR_CORE_V1_REFINEMENTS
  // Prevent poll flicker while a status update is in-flight
  const updatingIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    updatingIdRef.current = updatingId;
  }, [updatingId]);

'@
$txt = [regex]::Replace($txt, $updatingLinePat, '$0' + $refInsert, 1)
Ok "Inserted updatingIdRef + sync effect."

# ------------------------------------------------------------
# B) Pause polling while updating (20s interval)
# ------------------------------------------------------------
$intervalPat = '(?s)const\s+id\s*=\s*setInterval\(\(\)\s*=>\s*\{\s*loadOrders\(\)\.catch\(\(\)\s*=>\s*undefined\);\s*\}\s*,\s*20000\s*\);\s*'
if ($txt -notmatch $intervalPat) { Fail "Could not find 20s polling interval block (setInterval ... 20000)." }

$intervalNew = @'
const id = setInterval(() => {
      if (updatingIdRef.current) return;
      loadOrders().catch(() => undefined);
    }, 20000);
'@
$txt = [regex]::Replace($txt, $intervalPat, $intervalNew, 1)
Ok "Updated polling to pause while updating."

# ------------------------------------------------------------
# C) Completed today -> Completed orders (rename var if present + labels)
# ------------------------------------------------------------
if ($txt -match '\bcompletedToday\b') {
  $txt = $txt -replace '\bconst\s+completedToday\s*=\s*useMemo\b', 'const completedOrders = useMemo'
  $txt = $txt -replace '\bcompletedToday\b', 'completedOrders'
  Ok "Renamed completedToday -> completedOrders."
}
$txt = $txt -replace 'Completed today:', 'Completed orders:'
$txt = $txt -replace '(?s)(<h2 className="text-sm font-semibold text-slate-800 mb-2">\s*)Completed today(\s*</h2>)', '$1Completed orders$2'
Ok "Updated Completed labels."

# ------------------------------------------------------------
# D) UI wording: Driver arrived -> Mark ready (UI-only text)
# ------------------------------------------------------------
if ($txt -match 'Driver arrived') {
  $txt = $txt -replace 'Driver arrived', 'Mark ready'
  Ok "Updated action label: Driver arrived -> Mark ready."
} else {
  Info "Driver arrived label not found (skip label rename)."
}

# ------------------------------------------------------------
# E) Add Retry button to the simple error banner
# ------------------------------------------------------------
$errorBlockPat = '(?s)\{error\s*&&\s*\(\s*<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">\s*\{error\}\s*</div>\s*\)\s*\}'
if ($txt -notmatch $errorBlockPat) { Fail "Error banner block not found (expected simple error div)." }

$errorBlockNew = @'
{error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">{error}</div>
              <button
                type="button"
                className="shrink-0 rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                onClick={() => loadOrders().catch(() => undefined)}
                disabled={isLoading}
              >
                Retry
              </button>
            </div>
          </div>
        )}
'@
$txt = [regex]::Replace($txt, $errorBlockPat, $errorBlockNew, 1)
Ok "Added Retry button to error banner."

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $path"
Ok "Vendor Core V1 refinements applied."
