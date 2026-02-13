# ================================
# PATCH-DISPATCH-SEARCH-V2-HOOKS-SAFE.ps1
# JRIDE – Dispatch UI Search V2
# Hooks-safe, reversible
# ================================

$ErrorActionPreference = "Stop"

$FILE = "app\dispatch\page.tsx"

if (!(Test-Path $FILE)) {
  throw "File not found: $FILE"
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$FILE.bak.$ts"
Copy-Item $FILE $bak -Force
Write-Host "[OK] Backup created: $bak" -ForegroundColor Green

$txt = Get-Content $FILE -Raw

# ---- Guard: prevent double insert ----
if ($txt -match "JRIDE_UI_SEARCH_V2_START") {
  throw "Search V2 already exists. Aborting."
}

# ---- 1) Insert Search V2 state AFTER useState imports ----
$stateBlock = @"
  /* JRIDE_UI_SEARCH_V2_START */
  const [qBooking, setQBooking] = useState("");
  const [qPhone, setQPhone] = useState("");
  const [qStatus, setQStatus] = useState("");
  const [qTown, setQTown] = useState("");
  /* JRIDE_UI_SEARCH_V2_END */
"@

$txt = $txt -replace '(useState\([^)]*\);\s*)', "`$1`n$stateBlock"

# ---- 2) Insert filtered rows useMemo AFTER rowsForExport ----
$filterBlock = @"
  /* JRIDE_UI_SEARCH_V2_FILTER_START */
  const rowsFilteredUi = useMemo(() => {
    return rowsForExport.filter((b: any) => {
      if (qBooking && !String(b.booking_code || "").toLowerCase().includes(qBooking.toLowerCase())) return false;
      if (qPhone && !String(b.rider_phone || "").includes(qPhone)) return false;
      if (qStatus && String(b.status || "") !== qStatus) return false;
      if (qTown && String(b.town || "") !== qTown) return false;
      return true;
    });
  }, [rowsForExport, qBooking, qPhone, qStatus, qTown]);
  /* JRIDE_UI_SEARCH_V2_FILTER_END */
"@

$txt = $txt -replace '(const\s+rowsForExport\s*=\s*useMemo\([^)]*\);\s*)', "`$1`n$filterBlock"

# ---- 3) Replace rows usage in table rendering ----
$txt = $txt -replace '\browsForExport\.map\(', 'rowsFilteredUi.map('

# ---- 4) Insert Search UI ABOVE table ----
$uiBlock = @"
{/* JRIDE_UI_SEARCH_V2_UI_START */}
<div className="mb-3 flex flex-wrap gap-2 text-sm">
  <input
    className="rounded border px-2 py-1"
    placeholder="Booking code"
    value={qBooking}
    onChange={(e) => setQBooking(e.target.value)}
  />
  <input
    className="rounded border px-2 py-1"
    placeholder="Phone"
    value={qPhone}
    onChange={(e) => setQPhone(e.target.value)}
  />
  <select
    className="rounded border px-2 py-1"
    value={qStatus}
    onChange={(e) => setQStatus(e.target.value)}
  >
    <option value="">All status</option>
    <option value="pending">pending</option>
    <option value="assigned">assigned</option>
    <option value="on_the_way">on_the_way</option>
    <option value="on_trip">on_trip</option>
    <option value="completed">completed</option>
    <option value="cancelled">cancelled</option>
  </select>
  <input
    className="rounded border px-2 py-1"
    placeholder="Town"
    value={qTown}
    onChange={(e) => setQTown(e.target.value)}
  />
  <button
    type="button"
    className="rounded border px-3 py-1 hover:bg-slate-50"
    onClick={() => {
      setQBooking("");
      setQPhone("");
      setQStatus("");
      setQTown("");
    }}
  >
    Clear
  </button>
</div>
{/* JRIDE_UI_SEARCH_V2_UI_END */}
"@

$txt = $txt -replace '(<table)', "$uiBlock`n`$1"

Set-Content $FILE $txt -Encoding UTF8
Write-Host "[OK] Search V2 patch applied successfully." -ForegroundColor Green

Write-Host "`n[NEXT]" -ForegroundColor Cyan
Write-Host "npm.cmd run build" -ForegroundColor Cyan
