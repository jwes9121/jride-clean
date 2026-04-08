param(
    [Parameter(Mandatory = $true)]
    [string]$WebRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 100)
    Write-Host $Text
    Write-Host ("=" * 100)
}

function Ensure-Dir {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Read-Utf8NoBom {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
        return [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
    }
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Text
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Backup-File {
    param(
        [string]$SourcePath,
        [string]$BackupRoot,
        [string]$BaseRoot
    )

    $relative = $SourcePath.Substring($BaseRoot.Length).TrimStart('\','/')
    $dest = Join-Path $BackupRoot $relative
    $destDir = Split-Path -Parent $dest
    Ensure-Dir $destDir
    Copy-Item -LiteralPath $SourcePath -Destination $dest -Force
}

function Replace-ExactBlock {
    param(
        [string]$Content,
        [string]$OldBlock,
        [string]$NewBlock,
        [string]$Label
    )

    if (-not $Content.Contains($OldBlock)) {
        throw "Exact block not found for: $Label"
    }

    $updated = $Content.Replace($OldBlock, $NewBlock)

    if ($updated -eq $Content) {
        throw "Replacement produced no change for: $Label"
    }

    return $updated
}

$root = [System.IO.Path]::GetFullPath($WebRoot)
if (-not (Test-Path -LiteralPath $root)) {
    throw "WebRoot not found: $root"
}

$liveTripsClientPath = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $liveTripsClientPath)) {
    throw "Required file not found: $liveTripsClientPath"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outRoot = Join-Path $root "_patch_bak\PATCH-JRIDE_LIVETRIPSCLIENT_PENDING_ACTIVE_SCOPE_ONLY_V1.$timestamp"
$backupRoot = Join-Path $outRoot "backup"
$reportPath = Join-Path $outRoot "PATCH_REPORT.txt"

Ensure-Dir $backupRoot

Write-Section "JRIDE LIVETRIPSCLIENT PENDING/ACTIVE SCOPE ONLY PATCH"
Write-Host "WebRoot : $root"
Write-Host "Backup  : $backupRoot"

$original = Read-Utf8NoBom -Path $liveTripsClientPath
Backup-File -SourcePath $liveTripsClientPath -BackupRoot $backupRoot -BaseRoot $root

$patched = $original

Write-Section "PATCH 1 - FILTERKEY"

$old1 = @'
type FilterKey =
  | "dispatch" // pending + assigned + on_the_way
  | "pending"
  | "assigned"
  | "on_the_way"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "problem";
'@

$new1 = @'
type FilterKey =
  | "dispatch" // pending + assigned + on_the_way
  | "pending"
  | "active"
  | "assigned"
  | "accepted"
  | "fare_proposed"
  | "ready"
  | "on_the_way"
  | "arrived"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "problem";
'@

$patched = Replace-ExactBlock -Content $patched -OldBlock $old1 -NewBlock $new1 -Label "FilterKey"

Write-Section "PATCH 2 - STATUS ARRAYS"

$old2 = @'
const STUCK_THRESHOLDS_MIN = {
  on_the_way: 15,
  on_trip: 25,
};

function normStatus(s?: any) {
'@

$new2 = @'
const STUCK_THRESHOLDS_MIN = {
  on_the_way: 15,
  on_trip: 25,
};

const LIVETRIPS_PENDING_STATUSES = ["pending", "assigned", "accepted", "fare_proposed", "ready"];
const LIVETRIPS_ACTIVE_STATUSES = ["on_the_way", "arrived", "on_trip"];
const LIVETRIPS_DISPATCH_STATUSES = [...LIVETRIPS_PENDING_STATUSES, ...LIVETRIPS_ACTIVE_STATUSES];

function normStatus(s?: any) {
'@

$patched = Replace-ExactBlock -Content $patched -OldBlock $old2 -NewBlock $new2 -Label "status arrays"

Write-Section "PATCH 3 - ACTIVE STATUS FUNCTION"

$old3 = @'
function isActiveTripStatus(s: string) {
  return ["pending", "assigned", "on_the_way"].includes(s);
}
'@

$new3 = @'
function isActiveTripStatus(s: string) {
  return LIVETRIPS_DISPATCH_STATUSES.includes(s);
}
'@

$patched = Replace-ExactBlock -Content $patched -OldBlock $old3 -NewBlock $new3 -Label "isActiveTripStatus"

Write-Section "PATCH 4 - COUNTS"

$old4 = @'
  const counts = useMemo(() => {
    const c = {
      dispatch: 0,
      pending: 0,
      assigned: 0,
      on_the_way: 0,
      on_trip: 0,
      completed: 0,
      cancelled: 0,
      problem: 0,
    };
    for (const t of allTrips) {
      const s = normStatus(t.status);
      if (s === "pending") c.pending++;
      if (s === "assigned") c.assigned++;
      if (s === "on_the_way") c.on_the_way++;
      if (s === "on_trip") c.on_trip++;
      if (s === "completed") c.completed++;
      if (s === "cancelled") c.cancelled++;
      if (["pending", "assigned", "on_the_way"].includes(s)) c.dispatch++;
      if (computeIsProblem(t)) c.problem++;
    }
    return c;
  }, [allTrips]);
'@

$new4 = @'
  const counts = useMemo(() => {
    const c = {
      dispatch: 0,
      pending: 0,
      active: 0,
      assigned: 0,
      accepted: 0,
      fare_proposed: 0,
      ready: 0,
      on_the_way: 0,
      arrived: 0,
      on_trip: 0,
      completed: 0,
      cancelled: 0,
      problem: 0,
    };
    for (const t of allTrips) {
      const s = normStatus(t.status);
      if (s === "pending") c.pending++;
      if (s === "assigned") c.assigned++;
      if (s === "accepted") c.accepted++;
      if (s === "fare_proposed") c.fare_proposed++;
      if (s === "ready") c.ready++;
      if (s === "on_the_way") c.on_the_way++;
      if (s === "arrived") c.arrived++;
      if (s === "on_trip") c.on_trip++;
      if (s === "completed") c.completed++;
      if (s === "cancelled") c.cancelled++;
      if (LIVETRIPS_PENDING_STATUSES.includes(s)) c.pending++;
      if (LIVETRIPS_ACTIVE_STATUSES.includes(s)) c.active++;
      if (LIVETRIPS_DISPATCH_STATUSES.includes(s)) c.dispatch++;
      if (computeIsProblem(t)) c.problem++;
    }
    return c;
  }, [allTrips]);
'@

$patched = Replace-ExactBlock -Content $patched -OldBlock $old4 -NewBlock $new4 -Label "counts"

Write-Section "PATCH 5 - VISIBLE TRIPS"

$old5 = @'
  const visibleTrips = useMemo(() => {
    const f = tripFilter;

    let out: TripRow[] = [];
    if (f === "dispatch") {
      out = allTrips.filter((t) => ["pending", "assigned", "on_the_way"].includes(normStatus(t.status)));
    } else if (f === "problem") {
      out = allTrips.filter((t) => stuckTripIds.has(normTripId(t)));
    } else {
      out = allTrips.filter((t) => normStatus(t.status) === f);
    }

    // stable ordering: newest updated first
    out.sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0 as any).getTime() || 0;
      const tb = new Date(b.updated_at || b.created_at || 0 as any).getTime() || 0;
      return tb - ta;
    });

    // Ensure selection is inside visible set; if not, select first
    if (out.length) {
      const ids = new Set(out.map(normTripId));
      if (!selectedTripId || !ids.has(selectedTripId)) {
        setSelectedTripId(normTripId(out[0]));
      }
    } else {
      setSelectedTripId(null);
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrips, tripFilter, stuckTripIds]);
'@

$new5 = @'
  const visibleTrips = useMemo(() => {
    const f = tripFilter;

    let out: TripRow[] = [];
    if (f === "dispatch") {
      out = allTrips.filter((t) => LIVETRIPS_DISPATCH_STATUSES.includes(normStatus(t.status)));
    } else if (f === "pending") {
      out = allTrips.filter((t) => LIVETRIPS_PENDING_STATUSES.includes(normStatus(t.status)));
    } else if (f === "active") {
      out = allTrips.filter((t) => LIVETRIPS_ACTIVE_STATUSES.includes(normStatus(t.status)));
    } else if (f === "problem") {
      out = allTrips.filter((t) => stuckTripIds.has(normTripId(t)));
    } else {
      out = allTrips.filter((t) => normStatus(t.status) === f);
    }

    // stable ordering: newest updated first
    out.sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0 as any).getTime() || 0;
      const tb = new Date(b.updated_at || b.created_at || 0 as any).getTime() || 0;
      return tb - ta;
    });

    // Ensure selection is inside visible set; if not, select first
    if (out.length) {
      const ids = new Set(out.map(normTripId));
      if (!selectedTripId || !ids.has(selectedTripId)) {
        setSelectedTripId(normTripId(out[0]));
      }
    } else {
      setSelectedTripId(null);
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrips, tripFilter, stuckTripIds]);
'@

$patched = Replace-ExactBlock -Content $patched -OldBlock $old5 -NewBlock $new5 -Label "visibleTrips"

Write-Section "PATCH 6 - TOP FILTER PILLS"

$old6 = @'
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={pillClass(tripFilter === "dispatch")} onClick={() => setFilterAndFocus("dispatch")}>
          Dispatch <span className="text-xs opacity-80">{counts.dispatch}</span>
        </button>
        <button className={pillClass(tripFilter === "pending")} onClick={() => setFilterAndFocus("pending")}>
          Pending <span className="text-xs opacity-80">{counts.pending}</span>
        </button>
        <button className={pillClass(tripFilter === "assigned")} onClick={() => setFilterAndFocus("assigned")}>
          Assigned <span className="text-xs opacity-80">{counts.assigned}</span>
        </button>
        <button className={pillClass(tripFilter === "on_the_way")} onClick={() => setFilterAndFocus("on_the_way")}>
          On the way <span className="text-xs opacity-80">{counts.on_the_way}</span>
        </button>
        <button className={pillClass(tripFilter === "on_trip")} onClick={() => setFilterAndFocus("on_trip")}>
          On trip <span className="text-xs opacity-80">{counts.on_trip}</span>
        </button>
        <button className={pillClass(tripFilter === "completed")} onClick={() => setFilterAndFocus("completed")}>
          Completed <span className="text-xs opacity-80">{counts.completed}</span>
        </button>
        <button className={pillClass(tripFilter === "cancelled")} onClick={() => setFilterAndFocus("cancelled")}>
          Cancelled <span className="text-xs opacity-80">{counts.cancelled}</span>
        </button>
        <button
          className={[
            pillClass(tripFilter === "problem"),
            tripFilter === "problem" ? "" : "border-red-300 text-red-700 hover:bg-red-50",
          ].join(" ")}
          onClick={() => setFilterAndFocus("problem")}
          title={showThresholds}
        >
          Problem trips <span className="text-xs opacity-80">{counts.problem}</span>
        </button>

        <div className="ml-auto text-xs text-gray-600 self-center">
          {lastAction ? <span>Last action: {lastAction}</span> : <span>&nbsp;</span>}
        </div>
      </div>
'@

$new6 = @'
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={pillClass(tripFilter === "dispatch")} onClick={() => setFilterAndFocus("dispatch")}>
          Dispatch <span className="text-xs opacity-80">{counts.dispatch}</span>
        </button>
        <button className={pillClass(tripFilter === "pending")} onClick={() => setFilterAndFocus("pending")}>
          Pending tickets <span className="text-xs opacity-80">{counts.pending}</span>
        </button>
        <button className={pillClass(tripFilter === "active")} onClick={() => setFilterAndFocus("active")}>
          Active trips <span className="text-xs opacity-80">{counts.active}</span>
        </button>
        <button className={pillClass(tripFilter === "assigned")} onClick={() => setFilterAndFocus("assigned")}>
          Assigned <span className="text-xs opacity-80">{counts.assigned}</span>
        </button>
        <button className={pillClass(tripFilter === "accepted")} onClick={() => setFilterAndFocus("accepted")}>
          Accepted <span className="text-xs opacity-80">{counts.accepted}</span>
        </button>
        <button className={pillClass(tripFilter === "fare_proposed")} onClick={() => setFilterAndFocus("fare_proposed")}>
          Fare proposed <span className="text-xs opacity-80">{counts.fare_proposed}</span>
        </button>
        <button className={pillClass(tripFilter === "ready")} onClick={() => setFilterAndFocus("ready")}>
          Ready <span className="text-xs opacity-80">{counts.ready}</span>
        </button>
        <button className={pillClass(tripFilter === "on_the_way")} onClick={() => setFilterAndFocus("on_the_way")}>
          On the way <span className="text-xs opacity-80">{counts.on_the_way}</span>
        </button>
        <button className={pillClass(tripFilter === "arrived")} onClick={() => setFilterAndFocus("arrived")}>
          Arrived <span className="text-xs opacity-80">{counts.arrived}</span>
        </button>
        <button className={pillClass(tripFilter === "on_trip")} onClick={() => setFilterAndFocus("on_trip")}>
          On trip <span className="text-xs opacity-80">{counts.on_trip}</span>
        </button>
        <button className={pillClass(tripFilter === "completed")} onClick={() => setFilterAndFocus("completed")}>
          Completed <span className="text-xs opacity-80">{counts.completed}</span>
        </button>
        <button className={pillClass(tripFilter === "cancelled")} onClick={() => setFilterAndFocus("cancelled")}>
          Cancelled <span className="text-xs opacity-80">{counts.cancelled}</span>
        </button>
        <button
          className={[
            pillClass(tripFilter === "problem"),
            tripFilter === "problem" ? "" : "border-red-300 text-red-700 hover:bg-red-50",
          ].join(" ")}
          onClick={() => setFilterAndFocus("problem")}
          title={showThresholds}
        >
          Problem trips <span className="text-xs opacity-80">{counts.problem}</span>
        </button>

        <div className="ml-auto text-xs text-gray-600 self-center">
          {lastAction ? <span>Last action: {lastAction}</span> : <span>&nbsp;</span>}
        </div>
      </div>
'@

$patched = Replace-ExactBlock -Content $patched -OldBlock $old6 -NewBlock $new6 -Label "top filter pills"

Write-Utf8NoBom -Path $liveTripsClientPath -Text $patched
Write-Host "[OK] LiveTripsClient patched"

Write-Section "VERIFY"

$verify = Read-Utf8NoBom -Path $liveTripsClientPath
$checks = @(
    'Pending tickets',
    'Active trips',
    'const LIVETRIPS_PENDING_STATUSES = ["pending", "assigned", "accepted", "fare_proposed", "ready"];',
    'const LIVETRIPS_ACTIVE_STATUSES = ["on_the_way", "arrived", "on_trip"];',
    '| "active"',
    '| "accepted"',
    '| "fare_proposed"',
    '| "ready"',
    '| "arrived"'
)

foreach ($check in $checks) {
    if (-not $verify.Contains($check)) {
        throw "Verification failed for text: $check"
    }
    Write-Host "[OK] $check"
}

$report = @"
JRIDE LIVETRIPSCLIENT PENDING/ACTIVE SCOPE ONLY PATCH
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
WebRoot: $root

Patched file:
- app\admin\livetrips\LiveTripsClient.tsx

Changes applied:
1. Added active filter bucket
2. Added pending and active status arrays
3. Expanded dispatch grouping to include accepted, fare_proposed, ready, arrived
4. Added Pending tickets and Active trips pills
5. Added accepted, fare_proposed, ready, arrived status pills
6. No lifecycle writer changed
7. No wallet logic changed

Backup root:
$backupRoot
"@

$report | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Section "DONE"
Write-Host "Patch complete."
Write-Host "Report : $reportPath"
Write-Host "Backup : $backupRoot"