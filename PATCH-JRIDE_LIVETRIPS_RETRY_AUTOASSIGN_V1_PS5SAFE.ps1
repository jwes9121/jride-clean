param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE Patch: LiveTrips retry auto-assign (V1 / PS5-safe) =="
Write-Host "Root: $ProjRoot"

function Write-TextUtf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and !(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Read-TextUtf8 {
  param([Parameter(Mandatory=$true)][string]$Path)
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  if (!(Test-Path -LiteralPath $Path)) {
    Write-Host "[WARN] Missing file for backup: $Path"
    return
  }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($Path)
  $bak = Join-Path $bakDir ($name + ".bak." + $Tag + "." + $stamp)
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Replace-Exact {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Old,
    [Parameter(Mandatory=$true)][string]$New,
    [Parameter(Mandatory=$true)][string]$Label
  )

  $content = Read-TextUtf8 -Path $Path
  if ($content.IndexOf($Old) -lt 0) {
    throw "Anchor not found for $Label in $Path"
  }

  $updated = $content.Replace($Old, $New)
  if ($updated -eq $content) {
    throw "Replacement produced no change for $Label in $Path"
  }

  Write-TextUtf8NoBom -Path $Path -Content $updated
  Write-Host "[OK] Patched: $Label"
}

$clientPath = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
$routePath = Join-Path $ProjRoot "app\api\dispatch\retry-auto-assign\route.ts"

Backup-File -Path $clientPath -Tag "RETRY_AUTOASSIGN_V1"
Backup-File -Path $routePath -Tag "RETRY_AUTOASSIGN_V1"

# 1) Add retrying state
$oldState = @'
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driversDebug, setDriversDebug] = useState<string>("not-loaded");
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);

  const [stuckTripIds, setStuckTripIds] = useState<Set<string>>(new Set());
'@

$newState = @'
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driversDebug, setDriversDebug] = useState<string>("not-loaded");
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);
  const [retryingBookingCode, setRetryingBookingCode] = useState<string | null>(null);

  const [stuckTripIds, setStuckTripIds] = useState<Set<string>>(new Set());
'@
Replace-Exact -Path $clientPath -Old $oldState -New $newState -Label "Retry state"

# 2) Add retry handler after handleAssign
$oldHandlerTail = @'
  async function handleAssign(driverId: string) {
    const selectedTrip =
      (visibleTrips ?? []).find((t: any) => bookingCode(t) === selectedTripId) ??
      (visibleTrips?.[0] ?? null);

    if (!selectedTrip) {
      setLastAction("assign blocked: no selected trip");
      return;
    }

    const booking_code = s(selectedTrip?.booking_code).trim();
    const booking_id = s(selectedTrip?.id).trim();

    if (!booking_code && !booking_id) {
      setLastAction("assign blocked: missing booking identifier");
      return;
    }

    setAssigningDriverId(driverId);
    setErr(null);

    try {
      const res = await fetch("/api/dispatch/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          booking_code: booking_code || undefined,
          booking_id: booking_id || undefined,
          driver_id: driverId,
        }),
      });

      const j = await res.json().catch(() => ({}));

      if (!res.ok || j?.ok === false) {
        throw new Error(j?.message ?? j?.error ?? j?.code ?? `HTTP ${res.status}`);
      }

      setLastAction(
        `assigned ${driverId} to ${booking_code || booking_id} at ${formatPHTime(new Date().toISOString())}`
      );

      await fetchPageData();
    } catch (e: any) {
      const msg = e?.message ?? "Assignment failed";
      setErr(msg);
      setLastAction(`assign failed: ${msg}`);
    } finally {
      setAssigningDriverId(null);
    }
  }

  function jumpToLinkedTrip() {
'@

$newHandlerTail = @'
  async function handleAssign(driverId: string) {
    const selectedTrip =
      (visibleTrips ?? []).find((t: any) => bookingCode(t) === selectedTripId) ??
      (visibleTrips?.[0] ?? null);

    if (!selectedTrip) {
      setLastAction("assign blocked: no selected trip");
      return;
    }

    const booking_code = s(selectedTrip?.booking_code).trim();
    const booking_id = s(selectedTrip?.id).trim();

    if (!booking_code && !booking_id) {
      setLastAction("assign blocked: missing booking identifier");
      return;
    }

    setAssigningDriverId(driverId);
    setErr(null);

    try {
      const res = await fetch("/api/dispatch/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          booking_code: booking_code || undefined,
          booking_id: booking_id || undefined,
          driver_id: driverId,
        }),
      });

      const j = await res.json().catch(() => ({}));

      if (!res.ok || j?.ok === false) {
        throw new Error(j?.message ?? j?.error ?? j?.code ?? `HTTP ${res.status}`);
      }

      setLastAction(
        `assigned ${driverId} to ${booking_code || booking_id} at ${formatPHTime(new Date().toISOString())}`
      );

      await fetchPageData();
    } catch (e: any) {
      const msg = e?.message ?? "Assignment failed";
      setErr(msg);
      setLastAction(`assign failed: ${msg}`);
    } finally {
      setAssigningDriverId(null);
    }
  }

  async function handleRetryAutoAssign(trip: any) {
    const booking_code = s(trip?.booking_code).trim();
    const booking_id = s(trip?.id).trim();
    const st = s(trip?.status).trim().toLowerCase();

    if (!booking_code && !booking_id) {
      setLastAction("retry blocked: missing booking identifier");
      return;
    }

    if (st && st !== "requested" && st !== "dispatch") {
      setLastAction("retry blocked: booking is not in requested/dispatch state");
      return;
    }

    setRetryingBookingCode(booking_code || booking_id);
    setErr(null);

    try {
      const res = await fetch("/api/dispatch/retry-auto-assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          booking_code: booking_code || undefined,
          booking_id: booking_id || undefined,
        }),
      });

      const j = await res.json().catch(() => ({}));

      if (!res.ok || j?.ok === false) {
        throw new Error(j?.message ?? j?.error ?? j?.code ?? `HTTP ${res.status}`);
      }

      const resultCode = s(j?.assign?.code ?? "OK");
      const resultMessage = s(j?.assign?.message ?? "retry completed");
      setLastAction(`retry ${booking_code || booking_id}: ${resultCode} ${resultMessage}`.trim());

      await fetchPageData();
    } catch (e: any) {
      const msg = e?.message ?? "Retry auto-assign failed";
      setErr(msg);
      setLastAction(`retry failed: ${msg}`);
    } finally {
      setRetryingBookingCode(null);
    }
  }

  function jumpToLinkedTrip() {
'@
Replace-Exact -Path $clientPath -Old $oldHandlerTail -New $newHandlerTail -Label "Retry handler"

# 3) Add retry button inside trip card
$oldTripActions = @'
                            <div className="mt-3">
                              <TripLifecycleActions
                                trip={t as any}
                                onAfterAction={() => setLastAction("action completed")}
                              />
                            </div>

                            <div className="mt-3">
                              <TripWalletPanel trip={t as any} />
                            </div>
'@

$newTripActions = @'
                            <div className="mt-3 space-y-2">
                              <TripLifecycleActions
                                trip={t as any}
                                onAfterAction={() => setLastAction("action completed")}
                              />

                              {(s(t?.status).trim().toLowerCase() === "requested" || s(t?.status).trim().toLowerCase() === "dispatch") ? (
                                <button
                                  type="button"
                                  className="rounded border px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50"
                                  disabled={retryingBookingCode === (s(t?.booking_code).trim() || s(t?.id).trim())}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRetryAutoAssign(t);
                                  }}
                                >
                                  {retryingBookingCode === (s(t?.booking_code).trim() || s(t?.id).trim())
                                    ? "Retrying auto-assign..."
                                    : "Retry Auto-Assign"}
                                </button>
                              ) : null}
                            </div>

                            <div className="mt-3">
                              <TripWalletPanel trip={t as any} />
                            </div>
'@
Replace-Exact -Path $clientPath -Old $oldTripActions -New $newTripActions -Label "Retry button in trip card"

# 4) Write backend retry route
$routeContent = @'
import { NextResponse } from "next/server";

function ok(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function s(v: any): string {
  return String(v ?? "");
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const booking_code = s(body?.booking_code).trim();
    const booking_id = s(body?.booking_id).trim();

    if (!booking_code && !booking_id) {
      return bad("Provide booking_code or booking_id.", "BAD_REQUEST", 400);
    }

    const origin = new URL(req.url).origin;
    const adminSecret =
      req.headers.get("x-jride-admin-secret") ||
      req.headers.get("x-admin-secret") ||
      "";

    const assignRes = await fetch(origin + "/api/dispatch/assign", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(adminSecret ? { "x-jride-admin-secret": adminSecret } : {}),
      },
      cache: "no-store",
      body: JSON.stringify({
        booking_code: booking_code || undefined,
        booking_id: booking_id || undefined,
      }),
    });

    const assignJson: any = await assignRes.json().catch(async () => {
      const txt = await assignRes.text().catch(() => "");
      return {
        ok: false,
        code: "ASSIGN_NON_JSON",
        message: txt || `HTTP ${assignRes.status}`,
      };
    });

    if (!assignRes.ok || assignJson?.ok === false) {
      return ok({
        ok: true,
        retried: true,
        assign: {
          ok: false,
          code: s(assignJson?.code || `HTTP_${assignRes.status}`),
          message: s(assignJson?.message || assignJson?.error || "Retry completed with no assignment"),
        },
      });
    }

    return ok({
      ok: true,
      retried: true,
      assign: {
        ok: true,
        code: "OK",
        message: s(assignJson?.message || "Assignment completed"),
        booking_code: assignJson?.booking_code ?? null,
        booking_id: assignJson?.booking_id ?? null,
        assigned_driver_id: assignJson?.assigned_driver_id ?? null,
      },
    });
  } catch (e: any) {
    return bad("Unexpected retry-auto-assign error", "RETRY_AUTO_ASSIGN_UNEXPECTED", 500, {
      details: String(e?.message || e),
    });
  }
}
'@

Write-TextUtf8NoBom -Path $routePath -Content $routeContent
Write-Host "[OK] Wrote: app/api/dispatch/retry-auto-assign/route.ts"
Write-Host "[DONE] Patch applied."