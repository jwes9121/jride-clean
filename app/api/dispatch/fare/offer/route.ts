import { NextResponse } from "next/server";
import { POST as canonicalFareProposePost } from "@/app/api/driver/fare/propose/route";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  fare?: number | string | null;
  convenienceFee?: number | string | null;
};

function pickString(values: any[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

function toNumber(value: any, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = pickString([body.bookingId]);
    const bookingCode = pickString([body.bookingCode]);
    const driverId = pickString([body.driverId]);
    const baseFare = toNumber(body.fare, NaN);

    if (!driverId) {
      return NextResponse.json({ ok: false, code: "MISSING_DRIVER_ID" }, { status: 400 });
    }
    if (!bookingId && !bookingCode) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    }
    if (!Number.isFinite(baseFare) || baseFare <= 0) {
      return NextResponse.json({ ok: false, code: "INVALID_FARE" }, { status: 400 });
    }

    const convenienceFee = toNumber(body.convenienceFee, 15);
    const totalFare = Math.round((baseFare + convenienceFee) * 100) / 100;

    const forwarded = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        driver_id: driverId,
        booking_id: bookingId,
        booking_code: bookingCode,
        proposed_fare: totalFare,
      }),
    });

    const response = await canonicalFareProposePost(forwarded);
    const data = await response.json().catch(() => ({}));

    return NextResponse.json(
      {
        ...data,
        total_fare: totalFare,
        base_fare: baseFare,
        convenience_fee: convenienceFee,
        compatibility_route: "dispatch/fare/offer",
        canonical_route: "driver/fare/propose",
      },
      { status: response.status }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "FARE_OFFER_FATAL", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}