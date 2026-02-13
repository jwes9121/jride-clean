import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type Req = {
  booking_code?: string | null;
  driver_id?: string | null;
};

function norm(v: any) {
  return String(v ?? "").trim();
}

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/.test(v);
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as Req;

  const booking_code = norm(body.booking_code);
  const driver_id = norm(body.driver_id);

  if (!booking_code) {
    return NextResponse.json({ ok: false, code: "MISSING_BOOKING_CODE", message: "Missing booking_code" }, { status: 400 });
  }
  if (!driver_id || !isUuid(driver_id)) {
    return NextResponse.json({ ok: false, code: "MISSING_DRIVER_ID", message: "Missing/invalid driver_id" }, { status: 400 });
  }

  const br = await supabase.from("bookings").select("*").eq("booking_code", booking_code).maybeSingle();
  if (br.error || !br.data) {
    return NextResponse.json(
      { ok: false, code: "BOOKING_NOT_FOUND", message: br.error?.message || "Booking not found", booking_code },
      { status: 404 }
    );
  }

  const b: any = br.data;
  const status = norm(b.status).toLowerCase();

  // hard guards (no schema changes, no magic)
  if (status === "completed" || status === "cancelled") {
    return NextResponse.json(
      { ok: false, code: "NOT_ASSIGNABLE", message: "Booking is not assignable: " + status, booking_code, status },
      { status: 409 }
    );
  }

  // avoid overwriting active driver assignment unless it is still requested
  const alreadyHasDriver = !!b.driver_id;
  if (alreadyHasDriver && status && status !== "requested") {
    return NextResponse.json(
      { ok: false, code: "ALREADY_ASSIGNED", message: "Booking already has driver and is not assignable.", booking_code, status, driver_id: b.driver_id },
      { status: 409 }
    );
  }

  const upd = await supabase
    .from("bookings")
    .update({ driver_id, status: "assigned" })
    .eq("id", b.id)
    .select("*")
    .maybeSingle();

  if (upd.error) {
    return NextResponse.json(
      { ok: false, code: "UPDATE_FAILED", message: upd.error.message, booking_code, driver_id },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    assigned: true,
    booking_id: String(b.id),
    booking_code,
    driver_id,
    status: "assigned",
    booking: upd.data ?? null,
  });
}