import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { createClient } from "@/utils/supabase/server";

function isStaffRole(role: unknown) {
  const r = String(role || "").trim().toLowerCase();
  return r === "admin" || r === "dispatcher";
}

async function requireStaff() {
  const session = await auth();
  const role = (session?.user as any)?.role ?? "user";
  if (!isStaffRole(role)) return { ok: false as const };
  return { ok: true as const };
}

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

function assignmentGuardResponse(
  message: unknown,
  extra: Record<string, unknown>
) {
  const raw = String(message ?? "");

  if (raw.includes("DRIVER_ROSTER_INELIGIBLE:")) {
    return NextResponse.json(
      {
        ok: false,
        code: "DRIVER_ROSTER_INELIGIBLE",
        error: "driver_roster_ineligible",
        message: "Driver is not active on the JRide roster.",
        ...extra,
      },
      { status: 409 }
    );
  }

  if (raw.includes("DRIVER_WALLET_LOCKED:")) {
    return NextResponse.json(
      {
        ok: false,
        code: "DRIVER_WALLET_LOCKED",
        error: "driver_wallet_locked",
        message: "Driver wallet is locked.",
        ...extra,
      },
      { status: 409 }
    );
  }

  if (raw.includes("DRIVER_WALLET_BELOW_MINIMUM:")) {
    return NextResponse.json(
      {
        ok: false,
        code: "DRIVER_WALLET_BELOW_MINIMUM",
        error: "driver_wallet_below_minimum",
        message: "Driver wallet balance is below the minimum required for new bookings.",
        ...extra,
      },
      { status: 409 }
    );
  }

  if (raw.includes("DRIVER_WALLET_NOT_FOUND:")) {
    return NextResponse.json(
      {
        ok: false,
        code: "DRIVER_WALLET_NOT_FOUND",
        error: "driver_not_found",
        message: "Driver record was not found.",
        ...extra,
      },
      { status: 404 }
    );
  }

  return null;
}

export async function POST(req: Request) {
  const gate = await requireStaff();
  if (!gate.ok) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "Forbidden" }, { status: 403 });
  }

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
    const guardResponse = assignmentGuardResponse(
      upd.error.message,
      { booking_code, driver_id }
    );

    if (guardResponse) {
      return guardResponse;
    }

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