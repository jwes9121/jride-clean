# PATCH-DISPATCH-AUTOREFRESH-AND-GUARDS.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green

$txt = Get-Content $file -Raw

# 0) Sanity: must have reached()/normStatus() helpers (from earlier UI patch). If not, we still proceed but patch differently.
$hasHelpers = ($txt -match "const\s+normStatus\s*=") -and ($txt -match "const\s+reached\s*=")

# 1) Insert refreshRows() + polling useEffect exactly once
if ($txt -notmatch "function\s+refreshRows\s*\(") {

  # Try to insert right after reached() helper if present; else after first occurrence of setRows state.
  if ($hasHelpers) {
    $anchor = '(?ms)(const\s+reached\s*=\s*\([^\)]*\)\s*=>\s*\([^\;]*\)\s*;\s*)'
    if ($txt -notmatch $anchor) { Fail "Could not locate reached() helper to anchor refreshRows insertion." }

    $ins = @'
$1
async function refreshRows() {
  try {
    const res = await fetch("/api/dispatch/bookings", { cache: "no-store" as any });
    const data = await res.json().catch(() => null);

    // Accept multiple shapes:
    // - array
    // - { rows: [...] }
    // - { data: [...] }
    // - { ok: true, rows: [...] }
    const rows =
      Array.isArray(data) ? data :
      (data && Array.isArray(data.rows) ? data.rows :
      (data && Array.isArray(data.data) ? data.data :
      (data && data.ok && Array.isArray(data.rows) ? data.rows : null)));

    if (rows) setRows(rows as any);
  } catch (e) {
    // silent refresh; no UI disruption
    console.debug("refreshRows failed", e);
  }
}

// Auto-refresh every 5s
React.useEffect(() => {
  const id = setInterval(() => { refreshRows(); }, 5000);
  return () => clearInterval(id);
}, []);
'@

    $txt2 = [regex]::Replace($txt, $anchor, $ins, 1)
    if ($txt2 -eq $txt) { Fail "refreshRows insertion produced no change." }
    $txt = $txt2
    Write-Host "[OK] Inserted refreshRows() + polling effect." -ForegroundColor Green

  } else {
    # Fallback anchor: after setRows declaration
    $anchor = '(?ms)(const\s*\[\s*rows\s*,\s*setRows\s*\]\s*=\s*React\.useState[^\;]*;\s*)'
    if ($txt -notmatch $anchor) { Fail "Could not locate rows state to anchor refreshRows insertion." }

    $ins = @'
$1

async function refreshRows() {
  try {
    const res = await fetch("/api/dispatch/bookings", { cache: "no-store" as any });
    const data = await res.json().catch(() => null);
    const rows = Array.isArray(data) ? data : (data && data.rows ? data.rows : (data && data.data ? data.data : null));
    if (rows) setRows(rows as any);
  } catch (e) {
    console.debug("refreshRows failed", e);
  }
}

React.useEffect(() => {
  const id = setInterval(() => { refreshRows(); }, 5000);
  return () => clearInterval(id);
}, []);
'@

    $txt2 = [regex]::Replace($txt, $anchor, $ins, 1)
    if ($txt2 -eq $txt) { Fail "refreshRows insertion produced no change (fallback)." }
    $txt = $txt2
    Write-Host "[OK] Inserted refreshRows() + polling effect (fallback anchor)." -ForegroundColor Green
  }

} else {
  Write-Host "[OK] refreshRows() already present; skipping insert." -ForegroundColor Green
}

# 2) Ensure setStatus() calls refreshRows() on success (after ok response)
# We patch inside setStatus by inserting 'await refreshRows();' near the end of the OK path.
if ($txt -match "async function\s+setStatus\s*\(") {

  # Brace-scan setStatus block
  $marker = "async function setStatus"
  $start = $txt.IndexOf($marker, [StringComparison]::Ordinal)
  if ($start -lt 0) { Fail "setStatus() marker not found even though regex matched." }

  $open = $txt.IndexOf("{", $start)
  if ($open -lt 0) { Fail "Could not find opening '{' for setStatus()." }

  $depth = 0; $end = -1
  for ($i = $open; $i -lt $txt.Length; $i++) {
    $ch = $txt[$i]
    if ($ch -eq "{") { $depth++ }
    elseif ($ch -eq "}") {
      $depth--
      if ($depth -eq 0) { $end = $i; break }
    }
  }
  if ($end -lt 0) { Fail "Could not find closing '}' for setStatus() (brace scan failed)." }

  $before = $txt.Substring(0, $start)
  $fnText = $txt.Substring($start, ($end - $start + 1))
  $after  = $txt.Substring($end + 1)

  if ($fnText -notmatch "refreshRows\(") {
    # Insert right before the end of try{} success path: after JSON parse attempt block (or after console.log)
    if ($fnText -match "console\.log\(""Dispatch status updated:""") {
      $fnText2 = [regex]::Replace($fnText, '(?ms)(console\.log\("Dispatch status updated:[^;]*;\s*)', '$1' + "`n    await refreshRows();`n", 1)
    } else {
      # fallback: insert before final setPendingById(null) in finally if present
      $fnText2 = [regex]::Replace($fnText, '(?ms)(finally\s*\{\s*[\s\S]*?)setPendingById', '$1' + "await refreshRows();`n    setPendingById", 1)
    }

    if ($fnText2 -eq $fnText) { Fail "Could not inject refreshRows() into setStatus()." }
    $fnText = $fnText2
    $txt = $before + $fnText + $after
    Write-Host "[OK] Added refreshRows() call after successful status update." -ForegroundColor Green
  } else {
    Write-Host "[OK] setStatus() already calls refreshRows(); skipping." -ForegroundColor Green
  }

} else {
  Write-Host "[WARN] setStatus() not found; skipping refresh-after-status patch." -ForegroundColor Yellow
}

# 3) Tighten button guardrails (only if our previous disabled patterns exist)
# We look for the common patterns and expand them.

# En-route: disable if pending OR no driver OR not yet assigned OR already on_the_way+
$txtNew = $txt
$txtNew = [regex]::Replace(
  $txtNew,
  'disabled=\{\!\!pendingById\[b\.id\]\s*\|\|\s*reached\(b\.status,\s*"on_the_way"\)\}',
  'disabled={!!pendingById[b.id] || !b.driver_id || !reached(b.status,"assigned") || reached(b.status,"on_the_way")}',
  1
)

# Arrived: must have driver AND already on_the_way
$txtNew = [regex]::Replace(
  $txtNew,
  'disabled=\{\!\!pendingById\[b\.id\]\s*\|\|\s*reached\(b\.status,\s*"arrived"\)\}',
  'disabled={!!pendingById[b.id] || !b.driver_id || !reached(b.status,"on_the_way") || reached(b.status,"arrived")}',
  1
)

# Complete: must have driver AND already arrived
$txtNew = [regex]::Replace(
  $txtNew,
  'disabled=\{\!\!pendingById\[b\.id\]\s*\|\|\s*reached\(b\.status,\s*"completed"\)\}',
  'disabled={!!pendingById[b.id] || !b.driver_id || !reached(b.status,"arrived") || reached(b.status,"completed")}',
  1
)

# Cancel: disable if already cancelled/completed
$txtNew = [regex]::Replace(
  $txtNew,
  'disabled=\{\!\!pendingById\[b\.id\]\s*\|\|\s*reached\(b\.status,\s*"cancelled"\)\}',
  'disabled={!!pendingById[b.id] || reached(b.status,"completed") || reached(b.status,"cancelled")}',
  1
)

if ($txtNew -ne $txt) {
  $txt = $txtNew
  Write-Host "[OK] Patched button guardrails (En-route/Arrived/Complete/Cancel)." -ForegroundColor Green
} else {
  Write-Host "[WARN] Did not find expected disabled={...} patterns to expand. If guardrails didn't apply, paste the Actions button block and I'll patch your exact markup." -ForegroundColor Yellow
}

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[OK] Wrote: app\dispatch\page.tsx" -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Open /dispatch and watch the Queue update every 5 seconds (or after button clicks)." -ForegroundColor Cyan
Write-Host "3) Confirm En-route/Arrived/Complete are disabled until valid (driver assigned, previous step done)." -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback (if needed):" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
