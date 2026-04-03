import { NextRequest, NextResponse } from "next/server";

const STATUS_MAP: Record<string, string> = {
  pending: "requested",
  searching: "requested",
  assigned: "assigned",
  driver_accepted: "accepted",
  driver_arrived: "arrived",
  passenger_onboard: "on_trip",
  in_transit: "on_trip",
  dropoff: "completed",
  completed: "completed",
  cancelled: "cancelled",
  accepted: "accepted",
  fare_proposed: "fare_proposed",
  ready: "ready",
  on_the_way: "on_the_way",
  arrived: "arrived",
  on_trip: "on_trip",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    const bookingId = String(body?.booking_id ?? body?.bookingId ?? "").trim();
    const bookingCode = String(body?.booking_code ?? body?.bookingCode ?? "").trim();
    const rawStatus = String(body?.status ?? body?.nextStatus ?? "").trim().toLowerCase();

    if ((!bookingId && !bookingCode) || !rawStatus) {
      return NextResponse.json(
        { success: false, error: "Missing booking_id or bookingCode or status" },
        { status: 400 }
      );
    }

    const mappedStatus = STATUS_MAP[rawStatus];
    if (!mappedStatus) {
      return NextResponse.json(
        { success: false, error: `Unsupported status: ${rawStatus}` },
        { status: 400 }
      );
    }

    const origin = req.nextUrl.origin;
    const res = await fetch(`${origin}/api/dispatch/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        bookingId: bookingId || undefined,
        booking_id: bookingId || undefined,
        bookingCode: bookingCode || undefined,
        booking_code: bookingCode || undefined,
        status: mappedStatus,
      }),
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));

    return NextResponse.json(
      {
        success: res.ok,
        delegated: true,
        booking: json?.booking ?? null,
        result: json,
      },
      { status: res.status }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message ?? "Unexpected server error" },
      { status: 500 }
    );
  }
}