# PATCH-DISPATCH-PARITY-ACK-OBS.ps1
# Run from repo root: C:\Users\jwes9\Desktop\jride-clean-fresh
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\PATCH-DISPATCH-PARITY-ACK-OBS.ps1

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }

$root = Get-Location
$ts = Stamp

$files = @(
  "app\api\dispatch\status\route.ts",
  "app\dispatch\page.tsx"
)

Write-Host "[0/4] Repo: $root" -ForegroundColor Cyan

# 1) Backup
Write-Host "[1/4] Creating backups..." -ForegroundColor Cyan
foreach ($f in $files) {
  if (!(Test-Path $f)) { Fail "Missing file: $f" }
  Copy-Item $f "$f.bak.$ts" -Force
  Write-Host "  [OK] Backup: $f.bak.$ts" -ForegroundColor Green
}

# 2) Replace app\api\dispatch\status\route.ts
Write-Host "[2/4] Writing app\api\dispatch\status\route.ts ..." -ForegroundColor Cyan
$routeTs = @'
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  bookingId?: string;
  bookingCode?: string;
  status?: string;
};

function bad(message: string, extra: any = {}, status = 400) {
  return NextResponse.json({ ok: false, message, ...extra }, { status });
}

function statusColumnsPresent(sample: Record<string, any>) {
  const candidates = ["status", "trip_status", "booking_status", "dispatch_status", "ride_status"];
  return candidates.filter((c) => Object.prototype.hasOwnProperty.call(sample, c));
}

function safeHost(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
}

// ===== Observability (in-memory, no DB migration) =====
// Note: Vercel/serverless instances may reset between invocations; still useful for debugging/training.
type DispatchActionLog = {
  id: string;
  at: string; // ISO
  type: "status";
  actor: string;
  ip?: string | null;
  bookingId?: string | null;
  bookingCode?: string | null;
  nextStatus?: string | null;
  ok: boolean;
  httpStatus: number;
  message?: string;
  columnsUpdated?: string[];
};

function getLogStore(): DispatchActionLog[] {
  const g = globalThis as any;
  if (!g.__JRIDE_DISPATCH_LOGS) g.__JRIDE_DISPATCH_LOGS = [];
  return g.__JRIDE_DISPATCH_LOGS as DispatchActionLog[];
}

function pushLog(entry: DispatchActionLog) {
  const store = getLogStore();
  store.unshift(entry);
  if (store.length > 10) store.length = 10;
}

function randId() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function getActor(req: Request) {
  // allow the UI to pass a dispatcher name if you want later
  const h = req.headers;
  return (
    h.get("x-dispatcher") ||
    h.get("x-dispatcher-name") ||
    h.get("x-user") ||
    "unknown"
  );
}

function getIp(req: Request) {
  const h = req.headers;
  const xf = h.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return h.get("x-real-ip") || null;
}

// GET /api/dispatch/status?log=1  -> returns last 10 actions
export async function GET(req: Request) {
  const url = new URL(req.url);
  const wantLog = url.searchParams.get("log");
  if (!wantLog) return bad("Missing log=1", {}, 400);

  return NextResponse.json({
    ok: true,
    actions: getLogStore(),
  });
}

export async function POST(req: Request) {
  const actionId = randId();
  const actor = getActor(req);
  const ip = getIp(req);

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    const msg = "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL";
    pushLog({
      id: actionId,
      at: new Date().toISOString(),
      type: "status",
      actor,
      ip,
      ok: false,
      httpStatus: 500,
      message: msg,
    });
    return bad(msg, {}, 500);
  }

  if (!serviceKey) {
    const msg = "Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)";
    pushLog({
      id: actionId,
      at: new Date().toISOString(),
      type: "status",
      actor,
      ip,
      ok: false,
      httpStatus: 500,
      message: msg,
    });
    return bad(msg, {}, 500);
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    const msg = "Invalid JSON body";
    pushLog({
      id: actionId,
      at: new Date().toISOString(),
      type: "status",
      actor,
      ip,
      ok: false,
      httpStatus: 400,
      message: msg,
    });
    return bad(msg);
  }

  const bookingCode = body.bookingCode ? String(body.bookingCode).trim() : undefined;
  const bookingId = body.bookingId ? String(body.bookingId).trim() : undefined;
  const nextStatus = body.status ? String(body.status).trim() : "";

  if (!nextStatus || (!bookingCode && !bookingId)) {
    const msg = !nextStatus ? "Missing status" : "Missing bookingId or bookingCode";
    pushLog({
      id: actionId,
      at: new Date().toISOString(),
      type: "status",
      actor,
      ip,
      bookingId: bookingId ?? null,
      bookingCode: bookingCode ?? null,
      nextStatus: nextStatus ?? null,
      ok: false,
      httpStatus: 400,
      message: msg,
    });
    return bad(msg);
  }

  // Build filter (supports either booking_code or id)
  const where = bookingCode
    ? `booking_code=eq.${encodeURIComponent(bookingCode)}`
    : `id=eq.${encodeURIComponent(String(bookingId))}`;

  const baseUrl = `${supabaseUrl}/rest/v1/bookings?${where}`;

  // 1) Read row first (detect what status-like columns exist)
  const readRes = await fetch(`${baseUrl}&select=*`, {
    method: "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    cache: "no-store",
  });

  const readText = await readRes.text();
  if (!readRes.ok) {
    pushLog({
      id: actionId,
      at: new Date().toISOString(),
      type: "status",
      actor,
      ip,
      bookingId: bookingId ?? null,
      bookingCode: bookingCode ?? null,
      nextStatus,
      ok: false,
      httpStatus: readRes.status,
      message: "READ_FAILED",
    });
    return bad("READ_FAILED", { httpStatus: readRes.status, detail: readText }, readRes.status);
  }

  let rows: any[] = [];
  try { rows = JSON.parse(readText); } catch {}
  if (!Array.isArray(rows) || rows.length === 0) {
    pushLog({
      id: actionId,
      at: new Date().toISOString(),
      type: "status",
      actor,
      ip,
      bookingId: bookingId ?? null,
      bookingCode: bookingCode ?? null,
      nextStatus,
      ok: false,
      httpStatus: 404,
      message: "BOOKING_NOT_FOUND",
    });
    return bad("BOOKING_NOT_FOUND", { bookingCode, bookingId }, 404);
  }

  const sample = rows[0] as Record<string, any>;
  const cols = statusColumnsPresent(sample);

  if (cols.length === 0) {
    pushLog({
      id: actionId,
      at: new Date().toISOString(),
      type: "status",
      actor,
      ip,
      bookingId: bookingId ?? null,
      bookingCode: bookingCode ?? null,
      nextStatus,
      ok: false,
      httpStatus: 409,
      message: "NO_STATUS_COLUMNS_FOUND",
    });
    return bad(
      "NO_STATUS_COLUMNS_FOUND",
      {
        hint: "Bookings row has no known status-like columns. page-data might be deriving status via SQL/RPC.",
        keys: Object.keys(sample).slice(0, 60),
      },
      409
    );
  }

  // 2) Patch ALL present status-like columns
  const patchBody: any = {};
  for (const c of cols) patchBody[c] = nextStatus;

  const patchRes = await fetch(baseUrl, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patchBody),
  });

  const patchText = await patchRes.text();
  if (!patchRes.ok) {
    pushLog({
      id: actionId,
      at: new Date().toISOString(),
      type: "status",
      actor,
      ip,
      bookingId: bookingId ?? null,
      bookingCode: bookingCode ?? null,
      nextStatus,
      ok: false,
      httpStatus: patchRes.status,
      message: "PATCH_FAILED",
    });
    return bad(
      "PATCH_FAILED",
      {
        httpStatus: patchRes.status,
        detail: patchText,
        attempted: patchBody,
        supabaseHost: safeHost(supabaseUrl),
      },
      patchRes.status
    );
  }

  let patched: any[] = [];
  try { patched = JSON.parse(patchText); } catch {}

  pushLog({
    id: actionId,
    at: new Date().toISOString(),
    type: "status",
    actor,
    ip,
    bookingId: (patched?.[0]?.id ?? bookingId ?? null) as any,
    bookingCode: (patched?.[0]?.booking_code ?? bookingCode ?? null) as any,
    nextStatus,
    ok: true,
    httpStatus: 200,
    message: "OK",
    columnsUpdated: cols,
  });

  return NextResponse.json({
    ok: true,
    actionId,
    updated: Array.isArray(patched) ? patched.length : 1,
    bookingCode: patched?.[0]?.booking_code ?? bookingCode,
    id: patched?.[0]?.id ?? bookingId,
    status: nextStatus,
    columnsUpdated: cols,
    supabaseHost: safeHost(supabaseUrl),
  });
}
'@

# Write without BOM to avoid weird characters in TSX/TS
[System.IO.File]::WriteAllText((Join-Path $root "app\api\dispatch\status\route.ts"), $routeTs, (New-Object System.Text.UTF8Encoding($false)))

# 3) Replace app\dispatch\page.tsx
Write-Host "[3/4] Writing app\dispatch\page.tsx ..." -ForegroundColor Cyan
$dispatchTsx = @'
"use client";

import React, { useEffect, useMemo, useState } from "react";

type Booking = {
  id: string;
  booking_code?: string | null;
  status?: string | null;
};

type AckState =
  | { state: "idle" }
  | { state: "pending"; at: number }
  | { state: "ok"; at: number; actionId?: string; msg?: string }
  | { state: "err"; at: number; msg: string; httpStatus?: number };

function normStatus(s?: string | null) {
  return String(s || "").trim().toLowerCase();
}

// ===== Parity: same vocabulary as LiveTrips =====
// pending -> assigned -> on_the_way -> on_trip -> completed (+cancelled)
function allowedActions(status?: string | null) {
  const s = normStatus(status);
  if (s === "completed" || s === "cancelled") return [] as string[];

  const actions: string[] = [];

  if (s === "pending") actions.push("assigned");
  if (s === "assigned") actions.push("on_the_way");
  if (s === "on_the_way") actions.push("on_trip");
  if (s === "on_trip") actions.push("completed");

  // allow cancel anytime before final
  actions.push("cancelled");

  return actions;
}

async function postJson(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String(j?.message || j?.error || "REQUEST_FAILED");
    const err: any = new Error(msg);
    err.httpStatus = r.status;
    err.payload = j;
    throw err;
  }
  return j;
}

export default function DispatchPage() {
  const [rows, setRows] = useState<Booking[]>([]);
  const [ackMap, setAckMap] = useState<Record<string, AckState>>({});
  const [obs, setObs] = useState<any[]>([]);
  const [lastLoadAt, setLastLoadAt] = useState<number>(0);

  async function load() {
    const r = await fetch("/api/dispatch/bookings", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setRows((j.rows || []).filter(Boolean));
    setLastLoadAt(Date.now());
  }

  async function loadObs() {
    const r = await fetch("/api/dispatch/status?log=1", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (j?.ok && Array.isArray(j.actions)) setObs(j.actions);
  }

  useEffect(() => {
    load().catch(() => {});
    loadObs().catch(() => {});
    const t = setInterval(() => {
      load().catch(() => {});
      loadObs().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  function keyOf(b: Booking) {
    // Use booking_code if present, else id
    return String(b.booking_code || b.id);
  }

  function setAck(key: string, next: AckState) {
    setAckMap((m) => ({ ...m, [key]: next }));
  }

  async function setStatus(b: Booking, nextStatus: string) {
    const key = keyOf(b);
    setAck(key, { state: "pending", at: Date.now() });

    try {
      // status route supports bookingId OR bookingCode — we prefer bookingId since we always have it
      const payload: any = { status: nextStatus, bookingId: String(b.id) };
      const j = await postJson("/api/dispatch/status", payload);

      setAck(key, {
        state: "ok",
        at: Date.now(),
        actionId: j?.actionId,
        msg: `✓ Acknowledged (${nextStatus})`,
      });

      // refresh data + obs
      await load();
      await loadObs();

      // auto-clear ok state after a moment (keeps UI clean)
      setTimeout(() => {
        setAckMap((m) => {
          const cur = m[key];
          if (cur && cur.state === "ok") return { ...m, [key]: { state: "idle" } };
          return m;
        });
      }, 1500);
    } catch (e: any) {
      const msg = String(e?.message || "REJECTED");
      setAck(key, {
        state: "err",
        at: Date.now(),
        msg: `Rejected: ${msg}`,
        httpStatus: e?.httpStatus,
      });

      // keep errors visible a bit longer
      setTimeout(() => {
        setAckMap((m) => {
          const cur = m[key];
          if (cur && cur.state === "err") return { ...m, [key]: { state: "idle" } };
          return m;
        });
      }, 4000);

      // still refresh obs (might have a log entry)
      loadObs().catch(() => {});
    }
  }

  const rowsSorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return copy;
  }, [rows]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dispatch</h1>
          <div className="text-xs text-slate-600">
            Status vocabulary parity with LiveTrips:{" "}
            <span className="font-mono">pending → assigned → on_the_way → on_trip → completed</span> (+ cancelled)
          </div>
        </div>

        <div className="text-xs text-slate-600">
          Auto-refresh: 5s • Last load:{" "}
          {lastLoadAt ? new Date(lastLoadAt).toLocaleTimeString() : "—"}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main table */}
        <div className="lg:col-span-2 rounded border">
          <div className="p-3 border-b font-semibold">Bookings</div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b">
                <tr className="text-left">
                  <th className="p-2">Booking</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Acknowledgement</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rowsSorted.length === 0 ? (
                  <tr>
                    <td className="p-3 text-slate-600" colSpan={4}>
                      No rows returned from <span className="font-mono">/api/dispatch/bookings</span>.
                    </td>
                  </tr>
                ) : (
                  rowsSorted.map((b) => {
                    const key = keyOf(b);
                    const s = normStatus(b.status);
                    const acts = allowedActions(s);
                    const ack = ackMap[key] || { state: "idle" };

                    const isPending = ack.state === "pending";

                    function Btn(label: string, action: string, onClick: () => void) {
                      const disabled = isPending || !acts.includes(action);
                      return (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={onClick}
                          className={[
                            "mr-2 rounded border px-2 py-1 text-xs",
                            disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-50",
                          ].join(" ")}
                          title={disabled ? "Not allowed for this status (or pending)" : `Set status: ${action}`}
                        >
                          {isPending ? "Pending…" : label}
                        </button>
                      );
                    }

                    return (
                      <tr key={b.id} className="border-b">
                        <td className="p-2 font-mono">
                          {b.booking_code ? b.booking_code : b.id}
                        </td>

                        <td className="p-2">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                            {s || "—"}
                          </span>
                        </td>

                        <td className="p-2">
                          {ack.state === "idle" ? (
                            <span className="text-slate-400 text-xs">—</span>
                          ) : ack.state === "pending" ? (
                            <span className="text-xs text-amber-700">Pending…</span>
                          ) : ack.state === "ok" ? (
                            <span className="text-xs text-emerald-700">
                              {ack.msg || "✓ Acknowledged"}
                              {ack.actionId ? (
                                <span className="ml-2 text-[10px] text-slate-500">(id: {ack.actionId.slice(0, 8)})</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-xs text-red-700">
                              {ack.msg}
                              {ack.httpStatus ? (
                                <span className="ml-2 text-[10px] text-slate-500">(HTTP {ack.httpStatus})</span>
                              ) : null}
                            </span>
                          )}
                        </td>

                        <td className="p-2">
                          {Btn("Assign", "assigned", () => setStatus(b, "assigned"))}
                          {Btn("On the way", "on_the_way", () => setStatus(b, "on_the_way"))}
                          {Btn("On trip", "on_trip", () => setStatus(b, "on_trip"))}
                          {Btn("Complete", "completed", () => setStatus(b, "completed"))}
                          {Btn("Cancel", "cancelled", () => setStatus(b, "cancelled"))}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Observability panel */}
        <div className="rounded border">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="font-semibold">Observability</div>
            <button
              className="text-xs rounded border px-2 py-1 hover:bg-slate-50"
              onClick={() => loadObs().catch(() => {})}
              type="button"
            >
              Refresh
            </button>
          </div>

          <div className="p-3 text-xs text-slate-600">
            Last 10 dispatch actions (API-derived, no DB).
          </div>

          <div className="px-3 pb-3 space-y-2">
            {obs.length === 0 ? (
              <div className="text-xs text-slate-400">No actions yet.</div>
            ) : (
              obs.map((a: any) => (
                <div key={a.id} className="rounded border bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[11px]">
                      {String(a.bookingCode || a.bookingId || "—")}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {a.at ? new Date(a.at).toLocaleTimeString() : ""}
                    </div>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full border px-2 py-0.5">
                      {a.type || "status"}
                    </span>
                    <span className="rounded-full border px-2 py-0.5">
                      {a.nextStatus || "—"}
                    </span>
                    <span
                      className={[
                        "rounded-full border px-2 py-0.5",
                        a.ok ? "text-emerald-700 border-emerald-200 bg-emerald-50" : "text-red-700 border-red-200 bg-red-50",
                      ].join(" ")}
                    >
                      {a.ok ? "OK" : "BLOCKED"}
                    </span>
                    <span className="text-slate-500">
                      by {a.actor || "unknown"}
                    </span>
                  </div>

                  {!a.ok && a.message ? (
                    <div className="mt-1 text-[11px] text-red-700">
                      {a.message}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
'@

[System.IO.File]::WriteAllText((Join-Path $root "app\dispatch\page.tsx"), $dispatchTsx, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "[4/4] Done." -ForegroundColor Green
Write-Host ""
Write-Host "Next commands (do not use npm run build):" -ForegroundColor Yellow
Write-Host "  npm.cmd run build"
Write-Host "  npm.cmd run dev"
Write-Host ""
Write-Host "If anything breaks: restore from the .bak.$ts files immediately." -ForegroundColor Yellow
