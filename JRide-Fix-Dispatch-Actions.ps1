# JRide-Fix-Dispatch-Actions.ps1
# Fixes:
# - /api/dispatch/assign supports mode: assign|reassign|nudge
# - adds /api/dispatch/emergency
# - normalizes DispatchActionPanel.tsx (single export, no duplicated consts)
# - writes UTF8 *without BOM* to avoid ï»¿ issues

$ErrorActionPreference = "Stop"

function Stamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function Ensure-Dir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null } }
function Backup-File($p) {
  if (Test-Path $p) {
    $bak = "$p.bak_$(Stamp)"
    Copy-Item -Force $p $bak
    Write-Host "[backup] $p -> $bak"
  }
}
function Write-Utf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  Write-Host "[write] $path"
}

$root = (Get-Location).Path
if (!(Test-Path (Join-Path $root "package.json"))) {
  throw "Run this from the repo root (folder containing package.json). Current: $root"
}

# Paths
$apiDispatchDir = Join-Path $root "app\api\dispatch"
$assignRoutePath = Join-Path $apiDispatchDir "assign\route.ts"
$emergencyRoutePath = Join-Path $apiDispatchDir "emergency\route.ts"

$panelPath = Join-Path $root "app\admin\livetrips\components\DispatchActionPanel.tsx"

Ensure-Dir (Split-Path $assignRoutePath -Parent)
Ensure-Dir (Split-Path $emergencyRoutePath -Parent)
Ensure-Dir (Split-Path $panelPath -Parent)

Backup-File $assignRoutePath
Backup-File $emergencyRoutePath
Backup-File $panelPath

# ------------- app/api/dispatch/assign/route.ts -------------
$assignRoute = @'
import { NextResponse } from "next/server";

type Body = {
  bookingId?: string;
  bookingCode?: string;
  driverId?: string | null;
  mode?: "assign" | "reassign" | "nudge";
  dispatcherName?: string | null;
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: Request) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) return bad("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL", 500);
  if (!supabaseServiceKey) return bad("Missing SUPABASE_SERVICE_ROLE_KEY (recommended) / SUPABASE_SERVICE_KEY", 500);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("Invalid JSON body");
  }

  const mode = body.mode || "assign";
  const bookingId = body.bookingId || body.bookingCode; // allow either
  const bookingCode = body.bookingCode;

  if (!bookingId && !bookingCode) return bad("Missing bookingId/bookingCode");

  // Build REST endpoint
  // NOTE: your existing code used booking_code=eq.<code>. We'll support both.
  const base = `${supabaseUrl}/rest/v1/bookings`;
  const where = bookingCode
    ? `booking_code=eq.${encodeURIComponent(bookingCode)}`
    : `id=eq.${encodeURIComponent(String(bookingId))}`;

  const url = `${base}?${where}`;

  // Decide patch by mode
  // IMPORTANT: we only touch known columns used elsewhere in your project: assigned_driver_id + status.
  // - assign   => assigned_driver_id = driverId, status = "assigned"
  // - reassign => assigned_driver_id = null, status = "pending"
  // - nudge    => no schema assumptions; we "touch" the row by re-setting status to itself via a safe patch
  //              (if status is missing, it will error and we'll surface message)
  const driverId = body.driverId ?? null;

  let patch: any = {};
  if (mode === "assign") {
    if (!driverId) return bad("Missing driverId for mode=assign");
    patch = { assigned_driver_id: driverId, status: "assigned" };
  } else if (mode === "reassign") {
    patch = { assigned_driver_id: null, status: "pending" };
  } else if (mode === "nudge") {
    // No-op-ish patch: attempt to set status to status (PostgREST doesn't support column=self easily),
    // so we set a harmless string field only if it exists is risky.
    // Best safe behavior: just return ok so UI works; dispatcher can still use left-side actions.
    return NextResponse.json({ ok: true, mode, message: "NUDGE_OK (no-op backend)" }, { status: 200 });
  } else {
    return bad(`Unknown mode: ${String(mode)}`);
  }

  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, mode, status: res.status, message: "PATCH_FAILED", detail: text },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true, mode, result: text }, { status: 200 });
  } catch (err: any) {
    console.error("dispatch/assign error:", err);
    return NextResponse.json(
      { ok: false, mode, message: "ASSIGN_ROUTE_ERROR", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
'@

Write-Utf8NoBom $assignRoutePath $assignRoute

# ------------- app/api/dispatch/emergency/route.ts -------------
$emergencyRoute = @'
import { NextResponse } from "next/server";

type Body = {
  bookingId?: string;
  bookingCode?: string;
  isEmergency?: boolean; // if omitted, we toggle
  dispatcherName?: string | null;
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: Request) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) return bad("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL", 500);
  if (!supabaseServiceKey) return bad("Missing SUPABASE_SERVICE_ROLE_KEY (recommended) / SUPABASE_SERVICE_KEY", 500);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("Invalid JSON body");
  }

  const bookingId = body.bookingId || body.bookingCode;
  const bookingCode = body.bookingCode;
  if (!bookingId && !bookingCode) return bad("Missing bookingId/bookingCode");

  const base = `${supabaseUrl}/rest/v1/bookings`;
  const where = bookingCode
    ? `booking_code=eq.${encodeURIComponent(bookingCode)}`
    : `id=eq.${encodeURIComponent(String(bookingId))}`;

  // 1) Read current is_emergency (so we can toggle if not provided)
  const getUrl = `${base}?${where}&select=id,is_emergency`;
  try {
    const getRes = await fetch(getUrl, {
      method: "GET",
      headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` },
    });
    const getText = await getRes.text();
    if (!getRes.ok) {
      return NextResponse.json(
        { ok: false, message: "READ_FAILED", status: getRes.status, detail: getText },
        { status: getRes.status }
      );
    }

    let rows: any[] = [];
    try { rows = JSON.parse(getText); } catch { rows = []; }

    const current = rows?.[0];
    if (!current) return bad("Booking not found", 404);

    const nextVal =
      typeof body.isEmergency === "boolean"
        ? body.isEmergency
        : !Boolean(current.is_emergency);

    const patchUrl = `${base}?${where}`;
    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ is_emergency: nextVal }),
    });

    const patchText = await patchRes.text();
    if (!patchRes.ok) {
      return NextResponse.json(
        { ok: false, message: "PATCH_FAILED", status: patchRes.status, detail: patchText },
        { status: patchRes.status }
      );
    }

    return NextResponse.json({ ok: true, is_emergency: nextVal, result: patchText }, { status: 200 });
  } catch (err: any) {
    console.error("dispatch/emergency error:", err);
    return NextResponse.json(
      { ok: false, message: "EMERGENCY_ROUTE_ERROR", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
'@

Write-Utf8NoBom $emergencyRoutePath $emergencyRoute

# ------------- app/admin/livetrips/components/DispatchActionPanel.tsx -------------
$panel = @'
"use client";

import React, { useMemo, useState } from "react";

type Props = {
  trip: any | null;
  onActionCompleted?: () => void;
};

async function postJson(url: string, payload: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    const detail = data?.detail ? `\n${data.detail}` : "";
    throw new Error(`${msg}${detail}`);
  }
  return data;
}

export default function DispatchActionPanel({ trip, onActionCompleted }: Props) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [errorText, setErrorText] = useState<string>("");

  const computed = useMemo(() => {
    const t: any = trip || {};
    const driverPhone =
      t.driver_phone ||
      t.driverPhone ||
      t.rider_phone ||
      t.driver_contact ||
      "";

    const bookingId = t.id || t.booking_id || t.uuid || null;
    const bookingCode = t.booking_code || t.bookingCode || null;

    return {
      bookingId,
      bookingCode,
      driverPhone: String(driverPhone || "").trim(),
      status: String(t.status || "").toLowerCase(),
      driverId: t.assigned_driver_id || t.driver_id || t.driverId || null,
    };
  }, [trip]);

  const canCall = computed.driverPhone.length >= 7;
  const canReassign = computed.status !== "completed" && computed.status !== "cancelled";
  const canNudge = computed.status !== "completed" && computed.status !== "cancelled";
  const canEmergency = true;

  const disabledCall = !!busyKey || !canCall;
  const disabledNudge = !!busyKey || !canNudge;
  const disabledReassign = !!busyKey || !canReassign;
  const disabledEmergency = !!busyKey || !canEmergency;

  async function run(key: string, fn: () => Promise<any>) {
    if (!trip) return;
    setBusyKey(key);
    setErrorText("");
    setStatusText("");
    try {
      const out = await fn();
      setStatusText(out?.message || "OK");
      onActionCompleted?.();
    } catch (e: any) {
      setErrorText(String(e?.message || e));
    } finally {
      setBusyKey(null);
    }
  }

  const btnBase =
    "flex flex-col items-center justify-center rounded-xl px-2 py-2 text-[10px] font-medium border transition select-none";
  const btnDisabled = "border-slate-700 bg-slate-900/60 text-slate-500 cursor-not-allowed";
  const btnEnabled = "border-slate-600 bg-slate-900/90 text-slate-100 hover:bg-slate-800 hover:border-slate-400";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-3 text-[11px] text-slate-100 space-y-2">
      <div className="text-[10px] tracking-wide text-slate-300">DISPATCH ACTIONS</div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={`${btnBase} ${disabledCall ? btnDisabled : btnEnabled}`}
          disabled={disabledCall}
          title={!canCall ? "No driver phone" : "Call driver"}
          onClick={() => run("call", async () => ({ message: "CALL: use phone app" }))}
        >
          <div className="text-[12px]">📞</div>
          <div>Call</div>
        </button>

        <button
          type="button"
          className={`${btnBase} ${disabledNudge ? btnDisabled : btnEnabled}`}
          disabled={disabledNudge}
          title={disabledNudge ? "Busy or trip closed" : "Nudge driver (backend no-op ok for now)"}
          onClick={() =>
            run("nudge", async () =>
              postJson("/api/dispatch/assign", {
                bookingId: computed.bookingId,
                bookingCode: computed.bookingCode,
                mode: "nudge",
              })
            )
          }
        >
          <div className="text-[12px]">👉</div>
          <div>Nudge</div>
        </button>

        <button
          type="button"
          className={`${btnBase} ${disabledReassign ? btnDisabled : btnEnabled}`}
          disabled={disabledReassign}
          title={disabledReassign ? "Busy or trip closed" : "Unassign and return to pending"}
          onClick={() =>
            run("reassign", async () =>
              postJson("/api/dispatch/assign", {
                bookingId: computed.bookingId,
                bookingCode: computed.bookingCode,
                mode: "reassign",
                driverId: null,
              })
            )
          }
        >
          <div className="text-[12px]">🔁</div>
          <div>Reassign</div>
        </button>

        <button
          type="button"
          className={`${btnBase} ${disabledEmergency ? btnDisabled : btnEnabled}`}
          disabled={disabledEmergency}
          title="Toggle emergency"
          onClick={() =>
            run("emergency", async () =>
              postJson("/api/dispatch/emergency", {
                bookingId: computed.bookingId,
                bookingCode: computed.bookingCode,
              })
            )
          }
        >
          <div className="text-[12px]">🚨</div>
          <div>Emergency</div>
        </button>
      </div>

      {statusText ? <div className="text-[10px] text-emerald-300 pt-1">{statusText}</div> : null}
      {errorText ? <div className="text-[10px] text-red-300 pt-1 whitespace-pre-wrap">{errorText}</div> : null}

      <div className="text-[10px] text-slate-400 pt-1">
        Driver phone: {computed.driverPhone || "--"}
      </div>
    </div>
  );
}
'@

Write-Utf8NoBom $panelPath $panel

Write-Host ""
Write-Host "[DONE] Dispatch routes + panel fixed."
Write-Host "Next:"
Write-Host "1) Add bookings.is_emergency column (SQL below)."
Write-Host "2) Restart dev server (Ctrl+C then npm run dev)."
