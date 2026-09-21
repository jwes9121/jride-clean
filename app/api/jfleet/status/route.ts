import { NextResponse } from "next/server";
import {
  getActiveJfleetPartner,
  jfleetFeatureFlagEnabled,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      {
        ok: true,
        enabled: false,
        brand: "JFleet",
        subtitle: "Vans, Pickups & Trucks for Hire",
      },
      { status: 200, headers }
    );
  }

  const active = await getActiveJfleetPartner();
  if (!active.ok) {
    return NextResponse.json(
      {
        ok: true,
        enabled: false,
        brand: "JFleet",
        subtitle: "Vans, Pickups & Trucks for Hire",
        reason: active.code,
      },
      { status: 200, headers }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      enabled: true,
      brand: "JFleet",
      subtitle: "Vans, Pickups & Trucks for Hire",
      quote_tat_minutes: active.partner.quote_tat_minutes,
      reservation_percent: Number(active.partner.reservation_percent),
      free_cancel_hours: active.partner.free_cancel_hours,
      late_cancel_percent: Number(active.partner.late_cancel_percent),
    },
    { status: 200, headers }
  );
}
