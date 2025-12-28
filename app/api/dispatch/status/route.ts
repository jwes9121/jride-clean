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
  let s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/[\s\-]+/g, "_");
  if (s === "new") return "requested";
  if (s === "ongoing") return "on_trip";
  return s;
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

export async function GET(req: Request) {
  const supabase = createClient();
  try {
    const url = new URL(req.url);
    const bookingId = url.searchParams.get("booking_id") || url.searchParams.get("id");
    const bookingCode = url.searchParams.get("booking_code") || url.searchParams.get("code");

    const bk = await fetchBooking(supabase, bookingId ?? null, bookingCode ?? null);
    if (!bk.data) {
      return NextResponse.json(
        { ok: false, code: "BOOKING_NOT_FOUND", message: bk.error || "Booking not found", booking_id: bookingId ?? null, booking_code: bookingCode ?? null },
        { status: 404 }
      );
    }

    const booking: any = bk.data;
    const cur = norm(booking.status) || "requested";
    const allowedNext = NEXT[cur] ?? [];
    const hasDriver = !!booking.driver_id;

    return NextResponse.json({
      ok: true,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      has_driver: hasDriver,
      allowed_next: allowedNext,
      booking
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", message: e?.message || "Unknown error" }, { status: 500 });
  }
}
export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as StatusReq;

  const force = Boolean((body as any).force);

  const target = norm(body.status);
  if (!target || !ALLOWED.includes(target as any)) {
    return NextResponse.json(
      { ok: false, code: "INVALID_STATUS", message: "Invalid status. Allowed: " + ALLOWED.join(", ") },
      { status: 400 }
    );
  }

  const bk = await fetchBooking(supabase, (body.booking_id ?? (body as any).id ?? null), body.booking_code ?? null);
  if (!bk.data) {
    return NextResponse.json({ ok: false, code: "BOOKING_NOT_FOUND", message: bk.error || "Booking not found" }, { status: 404 });
  }

  const booking: any = bk.data;
  const cur = norm(booking.status) || "requested";

  // Must have driver for statuses beyond requested (except cancel)
  const hasDriver = !!booking.driver_id;
  if (!hasDriver && target !== "requested" && target !== "cancelled") {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_DRIVER",
        message: "Cannot set status without driver_id",
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        current_status: cur,
        target_status: target,
        has_driver: hasDriver,
        allowed_next: NEXT[cur] ?? [],
        current_status_raw: booking.status ?? null
      },
      { status: 409 }
    );
  }

  // Idempotent: setting same status is OK
  if (cur === target) {
    
    // Audit: forced status changes (best effort; actor may be unknown depending on auth setup)
    if (force) {
      try {
        await supabase.from("admin_audit_log").insert({
          actor_id: null,
          actor_email: null,
          action: "FORCE_STATUS",
          booking_id: (booking as any)?.id ?? null,
          booking_code: (booking as any)?.booking_code ?? null,
          from_status: (booking as any)?.status ?? null,
          to_status: target ?? null,
          meta: { source: "dispatch/status" }
        } as any);
      } catch {}
    }
return NextResponse.json(
      { ok: true, changed: false, booking_id: String(booking.id), booking_code: booking.booking_code ?? null, status: booking.status ?? null, booking },
      { status: 200 }
    );
  }

  const allowedNext = NEXT[cur] ?? [];
  if (!force && !allowedNext.includes(target)) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_TRANSITION",
        message: `Cannot transition ${cur} -> ${target}`,
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        current_status: cur,
        target_status: target,
        has_driver: hasDriver,
        allowed_next: allowedNext
      },
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

  
  // Audit: forced status transitions (post-update; best effort)
  if (force) {
    try {
      await supabase.from("admin_audit_log").insert({
        actor_id: null,
        actor_email: null,
        action: "FORCE_STATUS",
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        from_status: cur ?? null,
        to_status: target ?? null,
        meta: { source: "dispatch/status", phase: "post-update", changed: true, note: body.note ?? null }
      } as any);
    } catch {}
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


