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