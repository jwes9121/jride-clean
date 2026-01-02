import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type StatusReq = {
  booking_id?: string | null;
  booking_code?: string | null;
  status?: string | null;
  note?: string | null;
  force?: boolean | null;
};

const ALLOWED = [
  "requested",
  "assigned",
  "on_the_way",
  "arrived",
  "enroute",
  "on_trip",
  "completed",
  "cancelled",
] as const;

const NEXT: Record<string, string[]> = {
  requested: ["assigned", "cancelled"],
  assigned: ["on_the_way", "arrived", "enroute", "cancelled"],
  on_the_way: ["arrived", "enroute", "cancelled"],
  arrived: ["on_trip", "completed", "cancelled"],
  enroute: ["arrived", "on_trip", "completed", "cancelled"],
  on_trip: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function norm(v: any): string {
  let s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/[\s\-]+/g, "_");
  if (s === "new") return "requested";
  if (s === "ongoing") return "on_trip";
  return s;
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function jsonErr(code: string, message: string, status: number, extra?: any) {
  return NextResponse.json(
    Object.assign({ ok: false, code, message }, extra || {}),
    { status }
  );
}
function getActorFromReq(req: Request): string {
  try {
    const h: any = (req as any)?.headers;
    const v =
      h?.get?.("x-dispatcher-id") ||
      h?.get?.("x-user-id") ||
      h?.get?.("x-admin-id") ||
      h?.get?.("x-actor") ||
      "system";
    return String(v || "system");
  } catch {
    return "system";
  }
}

async function bestEffortAudit(
  supabase: ReturnType<typeof createClient>,
  entry: {
    booking_id?: string | null;
    booking_code?: string | null;
    from_status?: string | null;
    to_status?: string | null;
    actor?: string | null;
    source?: string | null;
  }
): Promise<{ warning?: string }> {
  const payload: any = {
    booking_id: entry.booking_id ?? null,
    booking_code: entry.booking_code ?? null,
    from_status: entry.from_status ?? null,
    to_status: entry.to_status ?? null,
    actor: entry.actor ?? "system",
    source: entry.source ?? "dispatch/status",
    created_at: new Date().toISOString(),
  };

  const tables = ["dispatch_audit_log", "audit_log", "status_audit"];

  for (let i = 0; i < tables.length; i++) {
    const tbl = tables[i];
    try {
      const r: any = await supabase.from(tbl).insert(payload);
      if (!r?.error) return {};
    } catch {}
  }
  return { warning: "AUDIT_LOG_INSERT_FAILED" };
}


async function fetchBooking(
  supabase: ReturnType<typeof createClient>,
  booking_id?: string | null,
  booking_code?: string | null
): Promise<{ data: any | null; error: string | null }> {
  try {
    if (booking_id) {
      const r = await supabase.from("bookings").select("*").eq("id", booking_id).maybeSingle();
      return { data: r.data ?? null, error: r.error?.message || null };
    }
    if (booking_code) {
      const r = await supabase.from("bookings").select("*").eq("booking_code", booking_code).maybeSingle();
      return { data: r.data ?? null, error: r.error?.message || null };
    }
    return { data: null, error: "Missing booking_id or booking_code" };
  } catch (e: any) {
    return { data: null, error: e?.message || "Booking lookup failed" };
  }
}

async function tryUpdateBooking(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  patch: Record<string, any>
): Promise<{ ok: boolean; data: any | null; error: string | null }> {
  try {
    const r = await supabase.from("bookings").update(patch).eq("id", bookingId).select("*").maybeSingle();
    if (r.error) return { ok: false, data: null, error: r.error.message };
    return { ok: true, data: r.data ?? null, error: null };
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message || "Booking update failed" };
  }
}

// Best-effort: keep driver status roughly aligned (does NOT block booking update)
function driverStatusForBookingStatus(status: string): string | null {
  const s = norm(status);
  if (s === "assigned") return "assigned";
  if (s === "on_the_way" || s === "enroute") return "on_the_way";
  if (s === "arrived") return "arrived";
  if (s === "on_trip") return "on_trip";
  if (s === "completed") return "available";
  if (s === "cancelled") return "available";
  return null;
}

async function bestEffortUpdateDriverLocation(
  supabase: ReturnType<typeof createClient>,
  driverId: string,
  bookingStatus: string
): Promise<{ warning?: string }> {
  const mapped = driverStatusForBookingStatus(bookingStatus);
  if (!driverId || !mapped) return {};

  try {
    const r = await supabase
      .from("driver_locations")
      .update({ status: mapped, updated_at: new Date().toISOString() })
      .eq("driver_id", driverId);

    if (r.error) {
      // Do not fail the request. Surface as warning.
      return { warning: "DRIVER_LOCATION_STATUS_UPDATE_ERROR: " + r.error.message };
    }
    return {};
  } catch (e: any) {
    // If table doesn't exist or any other issue, do not fail booking update.
    return { warning: "DRIVER_LOCATION_STATUS_UPDATE_ERROR: " + (e?.message || "Unknown error") };
  }
}

export async function GET(req: Request) {
  const supabase = createClient();
  try {
    const url = new URL(req.url);
    const bookingId = url.searchParams.get("booking_id") || url.searchParams.get("id");
    const bookingCode = url.searchParams.get("booking_code") || url.searchParams.get("code");

    const bk = await fetchBooking(supabase, bookingId ?? null, bookingCode ?? null);
    if (!bk.data) {
      return jsonErr(
        "BOOKING_NOT_FOUND",
        bk.error || "Booking not found",
        404,
        { booking_id: bookingId ?? null, booking_code: bookingCode ?? null }
      );
    }

    const booking: any = bk.data;
    const cur = norm(booking.status) || "requested";
    const allowedNext = NEXT[cur] ?? [];
    const hasDriver = !!booking.driver_id;

    return jsonOk({
      ok: true,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      has_driver: hasDriver,
      allowed_next: allowedNext,
      booking,
    });
  } catch (e: any) {
    return jsonErr("SERVER_ERROR", e?.message || "Unknown error", 500);
  }
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as StatusReq;

  const force = Boolean(body.force);

  const target = norm(body.status);
  if (!target || !(ALLOWED as any).includes(target)) {
    return jsonErr(
      "INVALID_STATUS",
      "Invalid status. Allowed: " + ALLOWED.join(", "),
      400
    );
  }

  const bookingId = (body.booking_id ?? (body as any).id ?? null) as any;
  const bookingCode = body.booking_code ?? null;

  const bk = await fetchBooking(supabase, bookingId ?? null, bookingCode);
  if (!bk.data) {
    return jsonErr("BOOKING_NOT_FOUND", bk.error || "Booking not found", 404, {
      booking_id: bookingId ?? null,
      booking_code: bookingCode ?? null,
    });
  }

  const booking: any = bk.data;
  const cur = norm(booking.status) || "requested";
  const allowedNext = NEXT[cur] ?? [];
  const hasDriver = !!booking.driver_id;

  // Must have driver for statuses beyond requested (except cancelled)
  if (!hasDriver && target !== "requested" && target !== "cancelled") {
    return jsonErr("NO_DRIVER", "Cannot set status without driver_id", 409, {
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      target_status: target,
      has_driver: hasDriver,
      allowed_next: allowedNext,
      current_status_raw: booking.status ?? null,
    });
  }

  // Idempotent
  if (cur === target) {
    return jsonOk({
      ok: true,
      changed: false,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      status: booking.status ?? null,
      booking,
    });
  }

  // Strict transitions unless forced
  if (!force && !allowedNext.includes(target)) {
    return jsonErr("INVALID_TRANSITION", "Cannot transition " + cur + " -> " + target, 409, {
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      target_status: target,
      has_driver: hasDriver,
      allowed_next: allowedNext,
    });
  }

  // Try best-effort timestamp + note columns; fallback to status-only if columns don't exist.
  const nowIso = new Date().toISOString();
  const patch: Record<string, any> = { status: target };

  if (target === "assigned") patch.assigned_at = nowIso;
  if (target === "on_the_way" || target === "enroute") patch.enroute_at = nowIso;
  if (target === "arrived") patch.arrived_at = nowIso;
  if (target === "on_trip") patch.on_trip_at = nowIso;
  if (target === "completed") patch.completed_at = nowIso;
  if (target === "cancelled") patch.cancelled_at = nowIso;

  if (body.note && String(body.note).trim() !== "") {
    patch.status_note = String(body.note).trim();
  }

  let upd = await tryUpdateBooking(supabase, String(booking.id), patch);

  if (!upd.ok && upd.error && upd.error.toLowerCase().includes("column")) {
    upd = await tryUpdateBooking(supabase, String(booking.id), { status: target });
    if (!upd.ok) {
      return jsonErr("DISPATCH_STATUS_DB_ERROR", upd.error || "Booking update failed", 500, {
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        current_status: cur,
        target_status: target,
      });
    }
  }

  if (!upd.ok) {
    return jsonErr("DISPATCH_STATUS_DB_ERROR", upd.error || "Booking update failed", 500, {
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      target_status: target,
    });
  }

  const driverId = booking.driver_id ? String(booking.driver_id) : "";
    const drv = await bestEffortUpdateDriverLocation(supabase, driverId, target);

  const actor = getActorFromReq(req);
  const audit = await bestEffortAudit(supabase, {
    booking_id: String(booking.id),
    booking_code: booking.booking_code ?? null,
    from_status: cur,
    to_status: target,
    actor,
    source: "dispatch/status",
  });

  const warn = drv.warning
    ? (audit.warning ? (String(drv.warning) + "; " + String(audit.warning)) : String(drv.warning))
    : (audit.warning ? String(audit.warning) : null);

  return jsonOk({
    ok: true,
    changed: true,
    booking_id: String(booking.id),
    booking_code: booking.booking_code ?? null,
    status: target,
    allowed_next: NEXT[target] ?? [],
    booking: upd.data ?? null,
    warning: warn,
  });}

