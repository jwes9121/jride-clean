import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetOwner,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";

function clean(value: unknown, max = 1500): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetOwner(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const body = await req.json().catch(() => ({}));
  const bookingId = clean(body?.booking_id, 80);
  const requestedBy = clean(body?.requested_by || "customer", 20).toLowerCase();
  const description = clean(body?.description, 500);
  const routeLabel = clean(body?.route_label, 500);
  const fuelVehicleFee = amount(body?.fuel_vehicle_fee);
  const driverFee = amount(body?.driver_fee);
  const otherFee = amount(body?.other_fee);

  if (!bookingId || description.length < 2 || routeLabel.length < 2) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_ADDON_INPUT_REQUIRED",
        message: "Enter the side-trip description and additional route.",
      },
      { status: 400, headers }
    );
  }

  if (!["customer", "driver", "owner"].includes(requestedBy)) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_ADDON_REQUESTER_INVALID",
        message: "Choose who requested the additional trip.",
      },
      { status: 400, headers }
    );
  }

  if (
    !Number.isFinite(fuelVehicleFee) ||
    !Number.isFinite(driverFee) ||
    !Number.isFinite(otherFee) ||
    fuelVehicleFee < 0 ||
    driverFee < 0 ||
    otherFee < 0 ||
    fuelVehicleFee + driverFee + otherFee <= 0
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_ADDON_AMOUNT_INVALID",
        message: "The additional charge must be greater than zero.",
      },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_owner_propose_addon_v1", {
    p_booking_id: bookingId,
    p_owner_user_id: auth.user.id,
    p_requested_by: requestedBy,
    p_description: description,
    p_additional_route: { label: routeLabel },
    p_fuel_vehicle_fee: fuelVehicleFee,
    p_driver_fee: driverFee,
    p_other_fee: otherFee,
    p_notes: clean(body?.notes, 1000) || null,
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    let userMessage = "The additional trip charge could not be proposed.";
    if (message.includes("REQUIRES_ACTIVE_TRIP")) {
      userMessage = "Additional-route charges can be proposed only while the JFleet trip is active.";
    } else if (message.includes("PENDING_EXISTS")) {
      userMessage = "Resolve the current additional-route proposal before creating another.";
    }

    return NextResponse.json(
      { ok: false, code: "JFLEET_ADDON_PROPOSAL_REJECTED", message: userMessage },
      { status: 409, headers }
    );
  }

  return NextResponse.json(result.data, { status: 201, headers });
}
