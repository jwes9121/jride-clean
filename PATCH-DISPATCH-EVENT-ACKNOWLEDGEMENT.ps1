# PATCH-DISPATCH-EVENT-ACKNOWLEDGEMENT.ps1
# - Full file replace (no JSX anchor patching)
# - Adds event acknowledgement UX to Dispatch
# - Adds unified in-memory observability log shared by /dispatch/status and /dispatch/assign
# - ASCII-safe, writes UTF-8 (no BOM)

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }

$root = Get-Location
$ts = Stamp

$files = @(
  "app\api\dispatch\assign\route.ts",
  "app\api\dispatch\status\route.ts",
  "app\dispatch\page.tsx"
)

Write-Host "[0/4] Repo: $root" -ForegroundColor Cyan

# 1) Backups
Write-Host "[1/4] Creating backups..." -ForegroundColor Cyan
foreach ($f in $files) {
  if (!(Test-Path $f)) { Fail "Missing file: $f" }
  Copy-Item $f "$f.bak.$ts" -Force
  Write-Host "  [OK] Backup: $f.bak.$ts" -ForegroundColor Green
}

function WriteUtf8NoBom([string]$path, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllBytes((Join-Path $root $path), $enc.GetBytes($text))
}

# 2) app/api/dispatch/status/route.ts
Write-Host "[2/4] Writing app/api/dispatch/status/route.ts ..." -ForegroundColor Cyan
$statusRoute = @'
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

function safeHost(u: string) {
  try { return new URL(u).host; } catch { return ""; }
}

function statusColumnsPresent(sample: Record<string, any>) {
  const candidates = ["status", "trip_status", "booking_status", "dispatch_status", "ride_status"];
  return candidates.filter((c) => Object.prototype.hasOwnProperty.call(sample, c));
}

// ===== Observability (in-memory, no DB migration) =====
export type DispatchActionLog = {
  id: string;
  at: string;
  type: "status" | "assign";
  actor: string;
  ip?: string | null;
  bookingId?: string | null;
  bookingCode?: string | null;
  nextStatus?: string | null;
  driverId?: string | null;
  force?: boolean;
  ok: boolean;
  httpStatus: number;
  code?: string;
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
  const h = req.headers;
  return h.get("x-dispatcher") || h.get("x-dispatcher-name") || h.get("x-user") || "unknown";
}

function getIp(req: Request) {
  const h = req.headers;
  const xf = h.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return h.get("x-real-ip") || null;
}

// GET /api/dispatch/status?log=1 -> last 10 actions (status + assign)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const wantLog = url.searchParams.get("log");
  if (!wantLog) return bad("Missing log=1", {}, 400);
  return NextResponse.json({ ok: true, actions: getLogStore() });
}

export async function POST(req: Request) {
  const actionId = randId();
  const actor = getActor(req);
  const ip = getIp(req);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    const msg = "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL";
    pushLog({ id: actionId, at: new Date().toISOString(), type: "status", actor, ip, ok: false, httpStatus: 500, message: msg });
    return bad(msg, {}, 500);
  }
  if (!serviceKey) {
    const msg = "Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)";
    pushLog({ id: actionId, at: new Date().toISOString(), type: "status", actor, ip, ok: false, httpStatus: 500, message: msg });
    return bad(msg, {}, 500);
  }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch {
    const msg = "Invalid JSON body";
    pushLog({ id: actionId, at: new Date().toISOString(), type: "status", actor, ip, ok: false, httpStatus: 400, message: msg });
    return bad(msg);
  }

  const bookingCode = body.bookingCode ? String(body.bookingCode).trim() : undefined;
  const bookingId = body.bookingId ? String(body.bookingId).trim() : undefined;
  const nextStatus = body.status ? String(body.status).trim() : "";

  if (!nextStatus || (!bookingCode && !bookingId)) {
    const msg = !nextStatus ? "Missing status" : "Missing bookingId or bookingCode";
    pushLog({
      id: actionId, at: new Date().toISOString(), type: "status", actor, ip,
      bookingId: bookingId ?? null, bookingCode: bookingCode ?? null, nextStatus: nextStatus ?? null,
      ok: false, httpStatus: 400, message: msg
    });
    return bad(msg);
  }

  const where = bookingCode
    ? `booking_code=eq.${encodeURIComponent(bookingCode)}`
    : `id=eq.${encodeURIComponent(String(bookingId))}`;

  const baseUrl = `${supabaseUrl}/rest/v1/bookings?${where}`;

  // 1) Read row to detect status-like columns
  const readRes = await fetch(`${baseUrl}&select=*`, {
    method: "GET",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    cache: "no-store",
  });

  const readText = await readRes.text();
  if (!readRes.ok) {
    pushLog({
      id: actionId, at: new Date().toISOString(), type: "status", actor, ip,
      bookingId: bookingId ?? null, bookingCode: bookingCode ?? null, nextStatus,
      ok: false, httpStatus: readRes.status, code: "READ_FAILED", message: "READ_FAILED"
    });
    return bad("READ_FAILED", { httpStatus: readRes.status, detail: readText }, readRes.status);
  }

  let rows: any[] = [];
  try { rows = JSON.parse(readText); } catch {}
  if (!Array.isArray(rows) || rows.length === 0) {
    pushLog({
      id: actionId, at: new Date().toISOString(), type: "status", actor, ip,
      bookingId: bookingId ?? null, bookingCode: bookingCode ?? null, nextStatus,
      ok: false, httpStatus: 404, code: "BOOKING_NOT_FOUND", message: "Booking not found"
    });
    return bad("BOOKING_NOT_FOUND", { bookingCode, bookingId }, 404);
  }

  const sample = rows[0] as Record<string, any>;
  const cols = statusColumnsPresent(sample);

  if (cols.length === 0) {
    pushLog({
      id: actionId, at: new Date().toISOString(), type: "status", actor, ip,
      bookingId: bookingId ?? null, bookingCode: bookingCode ?? null, nextStatus,
      ok: false, httpStatus: 409, code: "NO_STATUS_COLUMNS_FOUND", message: "No status columns found"
    });
    return bad(
      "NO_STATUS_COLUMNS_FOUND",
      {
        hint: "Bookings row has no known status-like columns.",
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
      id: actionId, at: new Date().toISOString(), type: "status", actor, ip,
      bookingId: bookingId ?? null, bookingCode: bookingCode ?? null, nextStatus,
      ok: false, httpStatus: patchRes.status, code: "PATCH_FAILED", message: "PATCH_FAILED"
    });
    return bad(
      "PATCH_FAILED",
      { httpStatus: patchRes.status, detail: patchText, attempted: patchBody, supabaseHost: safeHost(supabaseUrl) },
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
    code: "OK",
    message: "OK",
    columnsUpdated: cols,
  });

  return NextResponse.json({
    ok: true,
    actionId,
    bookingCode: patched?.[0]?.booking_code ?? bookingCode,
    id: patched?.[0]?.id ?? bookingId,
    status: nextStatus,
    columnsUpdated: cols,
    supabaseHost: safeHost(supabaseUrl),
  });
}
'@
WriteUtf8NoBom "app\api\dispatch\status\route.ts" $statusRoute

# 3) app/api/dispatch/assign/route.ts
Write-Host "[3/4] Writing app/api/dispatch/assign/route.ts ..." -ForegroundColor Cyan
$assignRoute = @'
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type DispatchActionLog = {
  id: string;
  at: string;
  type: "status" | "assign";
  actor: string;
  ip?: string | null;
  bookingId?: string | null;
  bookingCode?: string | null;
  nextStatus?: string | null;
  driverId?: string | null;
  force?: boolean;
  ok: boolean;
  httpStatus: number;
  code?: string;
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
function getActor(req: NextRequest) {
  return req.headers.get("x-dispatcher") || req.headers.get("x-dispatcher-name") || req.headers.get("x-user") || "unknown";
}
function getIp(req: NextRequest) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ""
);

// Keep backward compatibility with older vocab while supporting LiveTrips vocab.
const ACTIVE_STATUSES = ["assigned", "on_the_way", "on_trip", "enroute", "arrived", "ongoing"];

async function isDriverBusy(driverId: string) {
  try {
    const { count, error } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", driverId)
      .in("status", ACTIVE_STATUSES);

    if (error) return true; // fail-safe
    return (count ?? 0) > 0;
  } catch {
    return true; // fail-safe
  }
}

// GET /api/dispatch/assign?log=1 -> same shared log
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (!url.searchParams.get("log")) {
    return NextResponse.json({ ok: false, message: "Missing log=1" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, actions: getLogStore() });
}

export async function POST(req: NextRequest) {
  const actionId = randId();
  const actor = getActor(req);
  const ip = getIp(req);

  try {
    const body = await req.json();

    const bookingId =
      body.bookingId ||
      body.booking_id ||
      body.bookingUUID ||
      body.booking_uuid ||
      null;

    const bookingCode =
      body.bookingCode ||
      body.booking_code ||
      null;

    const driverId =
      body.driverId ||
      body.driver_id ||
      null;

    const forceAssign = Boolean(body.forceAssign || body.force);

    if ((!bookingId && !bookingCode) || !driverId) {
      pushLog({
        id: actionId, at: new Date().toISOString(), type: "assign", actor, ip,
        bookingId: bookingId ? String(bookingId) : null,
        bookingCode: bookingCode ? String(bookingCode) : null,
        driverId: String(driverId || ""),
        force: forceAssign,
        ok: false, httpStatus: 400, code: "BAD_REQUEST", message: "Missing bookingId/bookingCode or driverId",
      });
      return NextResponse.json(
        { ok: false, code: "BAD_REQUEST", message: "Missing bookingId/bookingCode or driverId", actionId },
        { status: 400 }
      );
    }

    if (!forceAssign) {
      const busy = await isDriverBusy(String(driverId));
      if (busy) {
        pushLog({
          id: actionId, at: new Date().toISOString(), type: "assign", actor, ip,
          bookingId: bookingId ? String(bookingId) : null,
          bookingCode: bookingCode ? String(bookingCode) : null,
          driverId: String(driverId),
          force: forceAssign,
          ok: false, httpStatus: 409, code: "DRIVER_BUSY", message: "Driver has an active trip",
        });
        return NextResponse.json(
          { ok: false, code: "DRIVER_BUSY", message: "Driver has an active trip", actionId },
          { status: 409 }
        );
      }
    }

    // Update booking: driver_id + set status="assigned" for parity
    // Supports id OR booking_code filter.
    const q = supabase.from("bookings").update({
      driver_id: String(driverId),
      status: "assigned",
    });

    const { error } = bookingCode
      ? await q.eq("booking_code", String(bookingCode))
      : await q.eq("id", String(bookingId));

    if (error) {
      pushLog({
        id: actionId, at: new Date().toISOString(), type: "assign", actor, ip,
        bookingId: bookingId ? String(bookingId) : null,
        bookingCode: bookingCode ? String(bookingCode) : null,
        driverId: String(driverId),
        force: forceAssign,
        ok: false, httpStatus: 500, code: "ASSIGN_FAILED", message: error.message,
      });
      return NextResponse.json(
        { ok: false, code: "ASSIGN_FAILED", message: error.message, actionId },
        { status: 500 }
      );
    }

    pushLog({
      id: actionId, at: new Date().toISOString(), type: "assign", actor, ip,
      bookingId: bookingId ? String(bookingId) : null,
      bookingCode: bookingCode ? String(bookingCode) : null,
      driverId: String(driverId),
      force: forceAssign,
      ok: true, httpStatus: 200, code: forceAssign ? "FORCE_OK" : "OK", message: "OK",
      nextStatus: "assigned",
    });

    return NextResponse.json({ ok: true, actionId });
  } catch (err: any) {
    pushLog({
      id: actionId, at: new Date().toISOString(), type: "assign", actor, ip,
      ok: false, httpStatus: 500, code: "SERVER_ERROR", message: err?.message || "Unknown error",
    });
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: err?.message || "Unknown error", actionId },
      { status: 500 }
    );
  }
}
'@
WriteUtf8NoBom "app\api\dispatch\assign\route.ts" $assignRoute

# 4) app/dispatch/page.tsx (Ack + Observability)
Write-Host "[4/4] Writing app/dispatch/page.tsx ..." -ForegroundColor Cyan
$dispatchPage = @'
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
  const v = String(s || "").trim().toLowerCase();
  if (!v) return "";
  // Back-compat normalization
  if (v === "new") return "pending";
  if (v === "enroute") return "on_the_way";
  if (v === "ongoing") return "on_trip";
  // Keep "arrived" as-is (some data still uses it)
  return v;
}

function allowedActions(status?: string | null) {
  const s = normStatus(status);

  // Terminal
  if (s === "completed" || s === "cancelled") return [] as string[];

  // LiveTrips parity path
  if (s === "pending") return ["assigned", "cancelled"];
  if (s === "assigned") return ["on_the_way", "cancelled"];
  if (s === "on_the_way") return ["on_trip", "cancelled"];
  if (s === "on_trip") return ["completed", "cancelled"];

  // Back-compat: arrived can complete
  if (s === "arrived") return ["completed", "cancelled"];

  // Unknown status: allow cancel only (safe)
  return ["cancelled"];
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
    const msg = String(j?.message || j?.error || j?.code || "REQUEST_FAILED");
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
    // status route is the canonical shared log endpoint
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
    return String(b.booking_code || b.id);
  }

  function setAck(key: string, next: AckState) {
    setAckMap((m) => ({ ...m, [key]: next }));
  }

  async function setStatus(b: Booking, nextStatus: string) {
    const key = keyOf(b);
    setAck(key, { state: "pending", at: Date.now() });

    try {
      const j = await postJson("/api/dispatch/status", { bookingId: String(b.id), status: nextStatus });

      setAck(key, {
        state: "ok",
        at: Date.now(),
        actionId: j?.actionId,
        msg: "ACK: " + nextStatus,
      });

      await load();
      await loadObs();

      setTimeout(() => {
        setAckMap((m) => {
          const cur = m[key];
          if (cur && cur.state === "ok") return { ...m, [key]: { state: "idle" } };
          return m;
        });
      }, 1500);
    } catch (e: any) {
      const msg = String(e?.message || "REJECTED");
      setAck(key, { state: "err", at: Date.now(), msg: "REJECT: " + msg, httpStatus: e?.httpStatus });

      setTimeout(() => {
        setAckMap((m) => {
          const cur = m[key];
          if (cur && cur.state === "err") return { ...m, [key]: { state: "idle" } };
          return m;
        });
      }, 4000);

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
            Parity vocab: pending - assigned - on_the_way - on_trip - completed (+ cancelled)
          </div>
        </div>

        <div className="text-xs text-slate-600">
          Auto-refresh: 5s - Last load: {lastLoadAt ? new Date(lastLoadAt).toLocaleTimeString() : "-"}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
                      No rows from /api/dispatch/bookings
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
                          title={disabled ? "Not allowed for this status (or pending)" : "Set status: " + action}
                        >
                          {isPending ? "Pending..." : label}
                        </button>
                      );
                    }

                    return (
                      <tr key={b.id} className="border-b">
                        <td className="p-2 font-mono">{b.booking_code ? b.booking_code : b.id}</td>

                        <td className="p-2">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                            {s || "-"}
                          </span>
                        </td>

                        <td className="p-2">
                          {ack.state === "idle" ? (
                            <span className="text-slate-400 text-xs">-</span>
                          ) : ack.state === "pending" ? (
                            <span className="text-xs text-amber-700">Pending...</span>
                          ) : ack.state === "ok" ? (
                            <span className="text-xs text-emerald-700">
                              {ack.msg || "ACK"}
                              {ack.actionId ? (
                                <span className="ml-2 text-[10px] text-slate-500">(id: {String(ack.actionId).slice(0, 8)})</span>
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

        <div className="rounded border">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="font-semibold">Observability</div>
            <button className="text-xs rounded border px-2 py-1 hover:bg-slate-50" onClick={() => loadObs().catch(() => {})} type="button">
              Refresh
            </button>
          </div>

          <div className="p-3 text-xs text-slate-600">Last 10 actions (status + assign). No DB.</div>

          <div className="px-3 pb-3 space-y-2">
            {obs.length === 0 ? (
              <div className="text-xs text-slate-400">No actions yet.</div>
            ) : (
              obs.map((a: any) => (
                <div key={a.id} className="rounded border bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[11px]">{String(a.bookingCode || a.bookingId || "-")}</div>
                    <div className="text-[11px] text-slate-500">{a.at ? new Date(a.at).toLocaleTimeString() : ""}</div>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full border px-2 py-0.5">{String(a.type || "status")}</span>
                    {a.type === "assign" ? (
                      <span className="rounded-full border px-2 py-0.5">{String(a.driverId || "-")}</span>
                    ) : (
                      <span className="rounded-full border px-2 py-0.5">{String(a.nextStatus || "-")}</span>
                    )}
                    <span className={["rounded-full border px-2 py-0.5", a.ok ? "text-emerald-700 border-emerald-200 bg-emerald-50" : "text-red-700 border-red-200 bg-red-50"].join(" ")}>
                      {a.ok ? (a.code === "FORCE_OK" ? "FORCE" : "OK") : "BLOCKED"}
                    </span>
                    <span className="text-slate-500">by {String(a.actor || "unknown")}</span>
                  </div>

                  {!a.ok && a.message ? <div className="mt-1 text-[11px] text-red-700">{String(a.message)}</div> : null}
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
WriteUtf8NoBom "app\dispatch\page.tsx" $dispatchPage

Write-Host ""
Write-Host "[DONE] Patch applied." -ForegroundColor Green
Write-Host "Next commands:" -ForegroundColor Yellow
Write-Host "  npm.cmd run build"
Write-Host "  npm.cmd run dev"
