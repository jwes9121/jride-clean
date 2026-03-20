import { NextResponse } from "next/server";
import { POST as canonicalFareProposePost } from "@/app/api/driver/fare/propose/route";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  fare?: number | string | null;
  proposed_fare?: number | string | null;
};

function first(values: any[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const payload = {
      driver_id: first([body.driverId]),
      booking_id: first([body.bookingId]),
      booking_code: first([body.bookingCode]),
      proposed_fare: body.proposed_fare ?? body.fare,
    };

    const forwarded = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await canonicalFareProposePost(forwarded);
    const data = await response.json().catch(() => ({}));

    return NextResponse.json(
      {
        ...data,
        compatibility_route: "driver/fare-offer",
        canonical_route: "driver/fare/propose",
      },
      { status: response.status }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "FARE_OFFER_FATAL", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}