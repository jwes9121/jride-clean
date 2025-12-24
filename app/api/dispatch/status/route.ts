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