# PATCH-DISPATCH-STATUS-UI-FEEDBACK.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green

$txt = Get-Content $file -Raw

# --- 1) Ensure we have a per-row pending state (insert after rows state) ---
if ($txt -notmatch '\[pendingById,\s*setPendingById\]') {
  $rxRowsState = '(?ms)(const\s*\[\s*rows\s*,\s*setRows\s*\]\s*=\s*React\.useState<[^>]*>\(\s*\[\s*\]\s*\)\s*;\s*)'
  if ($txt -notmatch $rxRowsState) { Fail "Could not find rows state: const [rows, setRows] = React.useState<...>([]);" }

  $insert = @'
$1const [pendingById, setPendingById] = React.useState<Record<string, string | null>>({});
const btnClass = (disabled: boolean) =>
  "px-3 py-1 border rounded " + (disabled ? "opacity-50 cursor-not-allowed" : "");
const normStatus = (s: string) => {
  const map: Record<string, string> = {
    enroute: "on_the_way",
    "en-route": "on_the_way",
    en_route: "on_the_way",
    cancel: "cancelled",
    canceled: "cancelled",
  };
  return map[s] ?? s;
};
const order: Record<string, number> = {
  new: 0,
  pending: 0,
  assigned: 1,
  on_the_way: 2,
  arrived: 3,
  completed: 4,
  cancelled: 5,
  canceled: 5,
};
const reached = (cur: any, target: any) =>
  (order[String(cur ?? "")] ?? -1) >= (order[String(target ?? "")] ?? -1);
'@

  $txt2 = [regex]::Replace($txt, $rxRowsState, $insert, 1)
  if ($txt2 -eq $txt) { Fail "Pending-state insertion produced no change." }
  $txt = $txt2
  Write-Host "[OK] Inserted pending state + helpers." -ForegroundColor Green
} else {
  Write-Host "[OK] Pending state already present; skipping insert." -ForegroundColor Green
}

# --- 2) Replace setStatus() with UI-feedback version (brace scan) ---
$marker = "async function setStatus"
$start = $txt.IndexOf($marker, [StringComparison]::Ordinal)
if ($start -lt 0) { Fail "Could not find 'async function setStatus' in $file" }

$open = $txt.IndexOf("{", $start)
if ($open -lt 0) { Fail "Could not find opening '{' for setStatus() block." }

$depth = 0
$end = -1
for ($i = $open; $i -lt $txt.Length; $i++) {
  $ch = $txt[$i]
  if ($ch -eq "{") { $depth++ }
  elseif ($ch -eq "}") {
    $depth--
    if ($depth -eq 0) { $end = $i; break }
  }
}
if ($end -lt 0) { Fail "Could not find matching closing '}' for setStatus() (brace scan failed)." }

$before = $txt.Substring(0, $start)
$after  = $txt.Substring($end + 1)

$newFn = @"
async function setStatus(booking_id: string, status: string) {
  const apiStatus = normStatus(status);

  // Disable buttons for this row while request is in flight
  setPendingById((p) => ({ ...p, [booking_id]: apiStatus }));

  // Optimistic UI: update row status immediately
  setRows((prev) =>
    prev.map((b: any) => (b.id === booking_id ? { ...b, status: apiStatus } : b))
  );

  try {
    const res = await fetch("/api/dispatch/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: booking_id, status: apiStatus }),
    });

    const t = await res.text();

    if (!res.ok) {
      console.error("Dispatch status update failed:", t);
      alert("Failed to update trip status: " + t);
      return;
    }

    // If API returns a row, prefer it; otherwise keep optimistic status
    try {
      const data = JSON.parse(t);
      if (data && data.row) {
        setRows((prev) => prev.map((b: any) => (b.id === booking_id ? data.row : b)));
      }
    } catch (_) {
      // non-JSON OK response; ignore
    }
  } catch (e: any) {
    console.error(e);
    alert("Failed to update trip status");
  } finally {
    setPendingById((p) => ({ ...p, [booking_id]: null }));
  }
}
"@

$txt = $before + $newFn + $after
Write-Host "[OK] Replaced setStatus() with UI-feedback version." -ForegroundColor Green

# --- 3) Patch the 5 action buttons to disable/gray out based on status + pending ---
$repls = @(
  @{ from = '<button onClick=\{\(\)=>setStatus\(b\.id,"enroute"\)\} className="px-3 py-1 border rounded">En-route</button>'
     to   = '<button disabled={!!pendingById[b.id] || reached(b.status, "on_the_way")} onClick={()=>setStatus(b.id,"enroute")} className={btnClass(!!pendingById[b.id] || reached(b.status, "on_the_way"))}>En-route</button>' },
  @{ from = '<button onClick=\{\(\)=>setStatus\(b\.id,"arrived"\)\} className="px-3 py-1 border rounded">Arrived</button>'
     to   = '<button disabled={!!pendingById[b.id] || reached(b.status, "arrived")} onClick={()=>setStatus(b.id,"arrived")} className={btnClass(!!pendingById[b.id] || reached(b.status, "arrived"))}>Arrived</button>' },
  @{ from = '<button onClick=\{\(\)=>setStatus\(b\.id,"completed"\)\} className="px-3 py-1 border rounded">Complete</button>'
     to   = '<button disabled={!!pendingById[b.id] || reached(b.status, "completed")} onClick={()=>setStatus(b.id,"completed")} className={btnClass(!!pendingById[b.id] || reached(b.status, "completed"))}>Complete</button>' },
  @{ from = '<button onClick=\{\(\)=>setStatus\(b\.id,"canceled"\)\} className="px-3 py-1 border rounded">Cancel</button>'
     to   = '<button disabled={!!pendingById[b.id] || reached(b.status, "cancelled")} onClick={()=>setStatus(b.id,"canceled")} className={btnClass(!!pendingById[b.id] || reached(b.status, "cancelled"))}>Cancel</button>' }
)

# En-route string might be "en_route" or "en-route" in some versions, so also handle alternates.
$altEn = @(
  @{ from = '<button onClick=\{\(\)=>setStatus\(b\.id,"en_route"\)\} className="px-3 py-1 border rounded">En-route</button>'
     to   = '<button disabled={!!pendingById[b.id] || reached(b.status, "on_the_way")} onClick={()=>setStatus(b.id,"en_route")} className={btnClass(!!pendingById[b.id] || reached(b.status, "on_the_way"))}>En-route</button>' },
  @{ from = '<button onClick=\{\(\)=>setStatus\(b\.id,"en-route"\)\} className="px-3 py-1 border rounded">En-route</button>'
     to   = '<button disabled={!!pendingById[b.id] || reached(b.status, "on_the_way")} onClick={()=>setStatus(b.id,"en-route")} className={btnClass(!!pendingById[b.id] || reached(b.status, "on_the_way"))}>En-route</button>' }
)

$changedAny = $false
foreach ($r in ($repls + $altEn)) {
  $beforeLen = $txt.Length
  $txt2 = [regex]::Replace($txt, $r.from, $r.to, 1)
  if ($txt2 -ne $txt) { $txt = $txt2; $changedAny = $true }
}

if (-not $changedAny) {
  Fail "Could not patch the button blocks (exact HTML differed). Paste the 10-20 lines around the Actions buttons so I can patch your exact markup."
}

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[OK] Patched action buttons: disable + gray out after click and when status already reached." -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) /dispatch -> click En-route; it should gray out + status should change immediately" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback (if needed):" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
