import { NextRequest, NextResponse } from "next/server";
import { POST as canonicalFareProposePost } from "@/app/api/driver/fare/propose/route";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const bookingCode = String(body?.bookingCode ?? body?.booking_code ?? "").trim();
    const fare = Number(body?.fare ?? body?.proposed_fare);

    if (!bookingCode || !Number.isFinite(fare)) {
      return NextResponse.json(
        { ok: false, error: "MISSING_OR_INVALID_FIELDS" },
        { status: 400 }
      );
    }

    const forwarded = new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        booking_code: bookingCode,
        proposed_fare: fare,
      }),
    });

    const response = await canonicalFareProposePost(forwarded);
    const data = await response.json().catch(() => ({}));

    return NextResponse.json(
      {
        ...data,
        compatibility_route: "rides/fare",
        canonical_route: "driver/fare/propose",
      },
      { status: response.status }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}