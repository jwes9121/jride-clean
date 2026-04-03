import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

    const bookingId = String(body?.bookingId ?? body?.booking_id ?? "").trim();
    const bookingCode = String(body?.bookingCode ?? body?.booking_code ?? "").trim();
    const rawNextStatus = String(body?.nextStatus ?? body?.status ?? "").trim().toLowerCase();

    if ((!bookingId && !bookingCode) || !rawNextStatus) {
      return NextResponse.json(
        {
          ok: false,
          error: "BAD_REQUEST",
          message: "bookingId or bookingCode and nextStatus are required",
        },
        { status: 400 }
      );
    }

    const mappedStatus = STATUS_MAP[rawNextStatus];
    if (!mappedStatus) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_STATUS",
          message: `Unsupported legacy/admin status: ${rawNextStatus}`,
        },
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

    return NextResponse.json(json, { status: res.status });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: error?.message ?? "Unknown server error",
      },
      { status: 500 }
    );
  }
}