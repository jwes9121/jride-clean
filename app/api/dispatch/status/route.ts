import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type StatusReq = {
  booking_id?: string | null;
  booking_code?: string | null;
  status?: string | null;
  note?: string | null;
};

const ALLOWED = ["requested", "assigned", "on_the_way", "arrived", "enroute", "on_trip", "completed", "cancelled"] as const;

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

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

async function fetchBooking(supabase: ReturnType<typeof createClient>, booking_id?: string | null, booking_code?: string | null) {
  if (booking_id) {
    const r = await supabase.from("bookings").select("*").eq("id", booking_id).maybeSingle();
    return { data: r.data, error: r.error?.message || null };
  }
  if (booking_code) {
    const r = await supabase.from("bookings").select("*").eq("booking_code", booking_code).maybeSingle();
    return { data: r.data, error: r.error?.message || null };
  }
  return { data: null, error: "Missing booking_id or booking_code" };
}

async function bestEffortUpdate(supabase: ReturnType<typeof createClient>, bookingId: string, patch: Record<string, any>) {
  const r = await supabase.from("bookings").update(patch).eq("id", bookingId).select("*").maybeSingle();
  if (r.error) return { ok: false, error: r.error.message, data: null as any };
  return { ok: true, error: null as any, data: r.data };
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as StatusReq;

  const target = norm(body.status);
  if (!target || !ALLOWED.includes(target as any)) {
    return NextResponse.json(
      { ok: false, code: "INVALID_STATUS", message: "Invalid status. Allowed: " + ALLOWED.join(", ") },
      { status: 400 }
    );
  }

  const bk = await fetchBooking(supabase, body.booking_id ?? null, body.booking_code ?? null);
  if (!bk.data) {
    return NextResponse.json({ ok: false, code: "BOOKING_NOT_FOUND", message: bk.error || "Booking not found" }, { status: 404 });
  }

  const booking: any = bk.data;
  const cur = norm(booking.status) || "requested";

  // Must have driver for statuses beyond requested (except cancel)
  const hasDriver = !!booking.driver_id;
  if (!hasDriver && target !== "requested" && target !== "cancelled") {
    return NextResponse.json(
      { ok: false, code: "NO_DRIVER", message: "Cannot set status without driver_id", current_status: booking.status ?? null },
      { status: 409 }
    );
  }

  // Idempotent: setting same status is OK
  if (cur === target) {
    return NextResponse.json(
      { ok: true, changed: false, booking_id: String(booking.id), booking_code: booking.booking_code ?? null, status: booking.status ?? null, booking },
      { status: 200 }
    );
  }

  const allowedNext = NEXT[cur] ?? [];
  if (!allowedNext.includes(target)) {
    return NextResponse.json(
      { ok: false, code: "INVALID_TRANSITION", message: `Cannot transition ${cur} -> ${target}`, allowed_next: allowedNext },
      { status: 409 }
    );
  }

  // Best-effort timestamp columns (only if they exist; errors ignored)
  const patch: Record<string, any> = { status: target };

  const nowIso = new Date().toISOString();
  if (target === "assigned") patch.assigned_at = nowIso;
  if (target === "on_the_way" || target === "enroute") patch.enroute_at = nowIso;
  if (target === "arrived") patch.arrived_at = nowIso;
  if (target === "on_trip") patch.on_trip_at = nowIso;
  if (target === "completed") patch.completed_at = nowIso;
  if (target === "cancelled") patch.cancelled_at = nowIso;

  // Optional note (if you have a notes column, it will be ignored if missing)
  if (body.note && String(body.note).trim() !== "") patch.status_note = String(body.note).trim();

  // When completed/cancelled: driver becomes available automatically by busy-lock (because status leaves BUSY list)
  const upd = await bestEffortUpdate(supabase, String(booking.id), patch);

  // If timestamp/note columns do not exist, fallback to status-only update
  if (!upd.ok && upd.error && upd.error.toLowerCase().includes("column")) {
    const upd2 = await bestEffortUpdate(supabase, String(booking.id), { status: target });
    return NextResponse.json(
      {
        ok: upd2.ok,
        changed: true,
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        status: target,
        note: "Status updated. Extra columns not present; updated status only.",
        update_error: upd2.error,
        booking: upd2.data ?? null,
      },
      { status: upd2.ok ? 200 : 500 }
    );
  }

  return NextResponse.json(
    {
      ok: upd.ok,
      changed: true,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      status: target,
      update_error: upd.error,
      booking: upd.data ?? null,
    },
    { status: upd.ok ? 200 : 500 }
  );
}