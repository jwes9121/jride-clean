# PATCH-DISPATCH-DRIVER-DROPDOWN-FORCEASSIGN.ps1
# - Safe patch for app\dispatch\page.tsx
# - Adds per-row eligible driver dropdown + Assign gating + Force assign toggle
# - Also hard-fixes any 'row is not defined' inside setStatus() request body if present
# - Creates timestamped backup before changes

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$root = (Get-Location).Path
$file = Join-Path $root "app\dispatch\page.tsx"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $file -Raw

# ---------------------------
# A) HARD-FIX: if setStatus() request body references 'row' (causes: row is not defined)
# We replace the body JSON.stringify(...) inside fetch("/api/dispatch/status"...)
# only when we detect 'row' in the stringify object.
# ---------------------------
if ($txt -match '(?s)fetch\(\s*["'']/api/dispatch/status["''].*?body\s*:\s*JSON\.stringify\(\s*\{.*?\}\s*\)') {
  $block = [regex]::Match($txt, '(?s)fetch\(\s*["'']/api/dispatch/status["''].*?body\s*:\s*JSON\.stringify\(\s*\{.*?\}\s*\)', 'Singleline').Value
  if ($block -match '\brow\b') {
    $txt = [regex]::Replace(
      $txt,
      '(?s)(fetch\(\s*["'']/api/dispatch/status["''].*?body\s*:\s*)JSON\.stringify\(\s*\{.*?\}\s*\)',
      '$1JSON.stringify({ bookingId: booking_id, status: apiStatus })',
      1
    )
    Write-Host "[OK] setStatus(): removed leaked 'row' usage in request body." -ForegroundColor Green
  }
}

# ---------------------------
# B) Replace global assignDriverId with per-row selections + drivers list + forceAssign
# ---------------------------

# 1) Remove/replace old single driver-id state (if exists)
# Examples we handle:
#   const [assignDriverId, setAssignDriverId] = React.useState<string>("");
#   const [assignDriverId, setAssignDriverId] = React.useState("");
$stateRx = '(?m)^\s*const\s*\[\s*assignDriverId\s*,\s*setAssignDriverId\s*\]\s*=\s*React\.useState<[^>]*>\([^;]*\)\s*;\s*$|(?m)^\s*const\s*\[\s*assignDriverId\s*,\s*setAssignDriverId\s*\]\s*=\s*React\.useState\([^;]*\)\s*;\s*$'
if ($txt -match $stateRx) {
  $replacement = @'
  const [forceAssign, setForceAssign] = React.useState<boolean>(false);
  const [drivers, setDrivers] = React.useState<any[]>([]);
  const [driversError, setDriversError] = React.useState<string | null>(null);

  // per-booking driver selection (prevents "one input affects all rows")
  const [selectedDriverByBookingId, setSelectedDriverByBookingId] = React.useState<Record<string, string>>({});
'@
  $txt = [regex]::Replace($txt, $stateRx, $replacement, 1)
  Write-Host "[OK] Replaced assignDriverId state with drivers + per-row selection map." -ForegroundColor Green
} else {
  # If it doesn't exist, we still need these states somewhere; inject after rows state.
  $anchor = '(?m)^\s*const\s*\[\s*rows\s*,\s*setRows\s*\]\s*=\s*React\.useState'
  if ($txt -match $anchor) {
    $txt = [regex]::Replace($txt, $anchor, @"
`$0
  const [forceAssign, setForceAssign] = React.useState<boolean>(false);
  const [drivers, setDrivers] = React.useState<any[]>([]);
  const [driversError, setDriversError] = React.useState<string | null>(null);
  const [selectedDriverByBookingId, setSelectedDriverByBookingId] = React.useState<Record<string, string>>({});
"@, 1)
    Write-Host "[OK] Inserted drivers + per-row selection state after rows state." -ForegroundColor Green
  } else {
    Fail "Could not find rows state to anchor driver state insertion."
  }
}

# 2) Insert refreshDrivers() helper if missing
if ($txt -notmatch '(?m)^\s*async\s+function\s+refreshDrivers\s*\(') {
  $insertAfterLoad = '(?s)(async\s+function\s+load\s*\(\)\s*\{.*?\}\s*)'
  if ($txt -match $insertAfterLoad) {
    $refreshDrivers = @'
  async function refreshDrivers() {
    try {
      setDriversError(null);
      const res = await fetch("/api/dispatch/drivers", { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = (data && (data.error || data.message)) ? (data.error || data.message) : ("HTTP " + res.status);
        throw new Error(msg);
      }

      const list =
        (data && Array.isArray(data.drivers)) ? data.drivers :
        (data && Array.isArray(data.rows)) ? data.rows :
        Array.isArray(data) ? data : [];

      setDrivers(list);
    } catch (e: any) {
      setDrivers([]);
      setDriversError(e?.message || "Failed to load drivers");
    }
  }

'@
    $txt = [regex]::Replace($txt, $insertAfterLoad, ('$1' + $refreshDrivers), 1)
    Write-Host "[OK] Inserted refreshDrivers() helper after load()." -ForegroundColor Green
  } else {
    # fallback: insert after refreshRows() if present
    $insertAfterRefreshRows = '(?s)(async\s+function\s+refreshRows\s*\(\)\s*\{.*?\}\s*)'
    if ($txt -match $insertAfterRefreshRows) {
      $refreshDrivers = @'
  async function refreshDrivers() {
    try {
      setDriversError(null);
      const res = await fetch("/api/dispatch/drivers", { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = (data && (data.error || data.message)) ? (data.error || data.message) : ("HTTP " + res.status);
        throw new Error(msg);
      }

      const list =
        (data && Array.isArray(data.drivers)) ? data.drivers :
        (data && Array.isArray(data.rows)) ? data.rows :
        Array.isArray(data) ? data : [];

      setDrivers(list);
    } catch (e: any) {
      setDrivers([]);
      setDriversError(e?.message || "Failed to load drivers");
    }
  }

'@
      $txt = [regex]::Replace($txt, $insertAfterRefreshRows, ('$1' + $refreshDrivers), 1)
      Write-Host "[OK] Inserted refreshDrivers() helper after refreshRows()." -ForegroundColor Green
    } else {
      Fail "Could not find load() or refreshRows() to anchor refreshDrivers() insertion."
    }
  }
}

# 3) Add useEffect to refresh drivers periodically
if ($txt -notmatch '(?s)useEffect\(\s*\(\)\s*=>\s*\{\s*refreshDrivers\(\)') {
  $useEffectAnchor = '(?s)(React\.useEffect\([^;]*load\(\)[^;]*\);\s*)'
  if ($txt -match $useEffectAnchor) {
    $ins = @'
React.useEffect(() => {
  refreshDrivers();
  const id = setInterval(() => refreshDrivers(), 10000);
  return () => clearInterval(id);
}, []);
'@
    $txt = [regex]::Replace($txt, $useEffectAnchor, ('$1' + "`r`n" + $ins + "`r`n"), 1)
    Write-Host "[OK] Added drivers refresh useEffect() (10s)." -ForegroundColor Green
  } else {
    # fallback: insert before return (
    $returnAnchor = '(?m)^\s*return\s*\('
    if ($txt -match $returnAnchor) {
      $txt = [regex]::Replace($txt, $returnAnchor, @"
React.useEffect(() => {
  refreshDrivers();
  const id = setInterval(() => refreshDrivers(), 10000);
  return () => clearInterval(id);
}, []);

return (
"@, 1)
      Write-Host "[OK] Added drivers refresh useEffect() before return()." -ForegroundColor Green
    } else {
      Fail "Could not find a safe anchor to insert refreshDrivers useEffect."
    }
  }
}

# 4) Patch assign() to use per-row selection map, and include forceAssign in payload for backend compatibility (ignored if backend doesn't use it)
$assignRx = '(?s)async\s+function\s+assign\s*\(\s*booking_id\s*:\s*string\s*\)\s*\{.*?\}\s*'
if ($txt -match $assignRx) {
  $newAssign = @'
  async function assign(booking_id: string) {
    const driver_id = String(selectedDriverByBookingId[booking_id] ?? "").trim();
    if (!driver_id) return;

    try {
      const res = await fetch("/api/dispatch/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id, driver_id, force: forceAssign }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && (data.error || data.message)) || "Assign failed");

      if (data && data.row) {
        setRows((prev) => prev.map((b: any) => (b.id === booking_id ? data.row : b)));
      } else {
        await refreshRows();
      }

      setSelectedDriverByBookingId((prev) => ({ ...prev, [booking_id]: "" }));
    } catch (e: any) {
      setError(e?.message || "Assign failed");
    }
  }

'@
  $txt = [regex]::Replace($txt, $assignRx, $newAssign, 1)
  Write-Host "[OK] Replaced assign() to use per-row selection + force flag." -ForegroundColor Green
} else {
  Fail "Could not find assign(booking_id: string) to patch."
}

# ---------------------------
# C) UI: Add Force assign toggle under the title (Dispatch Panel)
# ---------------------------
if ($txt -notmatch 'Force assign \(override busy\)') {
  $titleAnchor = '(?m)^\s*<h1[^>]*>\s*Dispatch Panel\s*</h1>\s*$'
  if ($txt -match $titleAnchor) {
    $toggle = @'
      <div className="mt-2 text-sm flex items-center gap-3">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={forceAssign}
            onChange={(e) => setForceAssign(e.target.checked)}
          />
          <span>Force assign (override busy)</span>
        </label>
        <span className="text-xs opacity-70">
          {forceAssign ? "Override ON: showing busy drivers too" : "Override OFF: online drivers only"}
        </span>
        {driversError ? <span className="text-xs text-red-600">Drivers: {driversError}</span> : null}
      </div>
'@
    $txt = [regex]::Replace($txt, $titleAnchor, ('$0' + "`r`n" + $toggle), 1)
    Write-Host "[OK] Inserted Force assign toggle under title." -ForegroundColor Green
  } else {
    Write-Host "[WARN] Could not find Dispatch Panel <h1> anchor; skipping toggle insertion." -ForegroundColor Yellow
  }
}

# ---------------------------
# D) Render: Replace the Actions <input placeholder="driver_id"...> with a dropdown + gated Assign button
# ---------------------------

# 1) Inside rows.map callback, insert computed variables before "return ("
$mapReturnRx = '(?s)(\{rows\.map\([^)]*\)\s*\{\s*)(return\s*\()'
if ($txt -match $mapReturnRx) {
  $calc = @'
const alreadyAssigned = !!(b as any).driver_id;
const isTerminal = ["completed","cancelled","canceled","cancelled"].includes(String((b as any).status ?? ""));
const isPending = !!pendingById[(b as any).id];

const curTown = String((b as any).town ?? "").trim().toLowerCase();
const eligibleDrivers = drivers.filter((d: any) => {
  const dTown = String(d?.town ?? d?.zone ?? "").trim().toLowerCase();
  if (curTown && dTown && curTown !== dTown) return false;

  const st = String(d?.status ?? "").toLowerCase();
  if (!forceAssign) return st === "online";
  return (st === "online" || st === "busy" || st === "on_trip" || st === "assigned");
});

const onlineCount = eligibleDrivers.filter((d: any) => String(d?.status ?? "").toLowerCase() === "online").length;
const busyCount = Math.max(0, eligibleDrivers.length - onlineCount);

const selectedDriver = String(selectedDriverByBookingId[(b as any).id] ?? "").trim();
const canAssign = (!alreadyAssigned && !!selectedDriver && !isTerminal && !isPending);
'@
  $txt = [regex]::Replace($txt, $mapReturnRx, ('$1' + $calc + "`r`n" + '$2'), 1)
  Write-Host "[OK] Added per-row eligibility calculations inside rows.map." -ForegroundColor Green
} else {
  Write-Host "[WARN] Could not inject per-row calculations (rows.map anchor mismatch). We'll still patch the input block if possible." -ForegroundColor Yellow
}

# 2) Replace the input block (placeholder driver_id) with a select dropdown
$inputBlockRx = '(?s)<input[^>]*placeholder\s*=\s*["'']driver_id[^"''>]*["''][^>]*/>\s*'
if ($txt -match $inputBlockRx) {
  $dropdown = @'
                      <select
                        className="border rounded px-2 py-1 text-xs w-56"
                        value={String(selectedDriverByBookingId[(b as any).id] ?? "")}
                        onChange={(e) => setSelectedDriverByBookingId((prev) => ({ ...prev, [(b as any).id]: e.target.value }))}
                        disabled={alreadyAssigned || isTerminal || isPending}
                        title={alreadyAssigned ? "Already assigned" : "Select a driver"}
                      >
                        <option value="">
                          {driversError ? "Drivers error" : (eligibleDrivers.length ? `Select driver (${eligibleDrivers.length})` : "No eligible drivers")}
                        </option>
                        {eligibleDrivers.map((d: any) => (
                          <option key={String(d.id)} value={String(d.id)}>
                            {String(d.id).slice(0, 8)}… — {String(d.status || "unknown")} {d.town ? `(${d.town})` : ""}
                          </option>
                        ))}
                      </select>
                      <span className="text-xs ml-2 opacity-70">
                        Online {onlineCount}{forceAssign ? ` / Busy ${busyCount}` : ""}
                      </span>
'@
  $txt = [regex]::Replace($txt, $inputBlockRx, $dropdown, 1)
  Write-Host "[OK] Replaced driver_id input with eligible driver dropdown." -ForegroundColor Green
} else {
  Fail "Could not find the driver_id input (placeholder='driver_id') to replace."
}

# 3) Disable Assign button if no selected driver (and prevent clicking when pending/terminal/already assigned)
# Replace: <button onClick={()=>assign(b.id)} className="...">Assign</button>
$assignBtnRx = '(?s)<button\s+onClick=\{\(\)\s*=>\s*assign\(\s*b\.id\s*\)\}\s+className=\s*["''][^"''>]*["'']\s*>\s*Assign\s*</button>'
if ($txt -match $assignBtnRx) {
  $newBtn = @'
                      <button
                        onClick={() => assign((b as any).id)}
                        disabled={!canAssign}
                        className={btnClass(!canAssign)}
                        title={!canAssign ? "Select a driver first" : "Assign driver"}
                      >
                        Assign
                      </button>
'@
  $txt = [regex]::Replace($txt, $assignBtnRx, $newBtn, 1)
  Write-Host "[OK] Gated Assign button (disabled until driver selected)." -ForegroundColor Green
} else {
  Write-Host "[WARN] Could not find Assign button anchor to gate. (UI may differ)" -ForegroundColor Yellow
}

# 4) (Optional) disable status buttons when pending
# We won't change their behavior unless we can safely patch (avoid breaking UI).
# If the file has plain <button onClick={()=>setStatus...}> blocks, leave as-is.

# ---------------------------
# E) Final sanity checks
# ---------------------------
if ($txt -match 'setAssignDriverId\(') {
  Fail "Sanity check failed: found leftover setAssignDriverId(...) in page.tsx"
}
if ($txt -match '\bassignDriverId\b') {
  Fail "Sanity check failed: found leftover assignDriverId in page.tsx"
}

Set-Content -Path $file -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched app\dispatch\page.tsx successfully." -ForegroundColor Green

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run dev" -ForegroundColor Cyan
Write-Host "2) Open http://localhost:3000/dispatch" -ForegroundColor Cyan
Write-Host "3) Pick a row -> select driver from dropdown -> Assign (should enable only after selection)" -ForegroundColor Cyan
Write-Host "4) Toggle Force assign to include busy drivers (if any)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback (if needed):" -ForegroundColor Yellow
Write-Host "Copy-Item `"$bak`" `"$file`" -Force" -ForegroundColor Yellow
