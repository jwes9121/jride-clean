import { NextResponse } from "next/server";
import { updateDriverLocation } from "@/lib/liveDriverLocations";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { driverId, lat, lng, status } = body || {};

    if (!driverId || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json(
        { error: "driverId, lat, lng are required" },
        { status: 400 }
      );
    }

    await updateDriverLocation(
      String(driverId),
      Number(lat),
      Number(lng),
      (status as any) || "online"
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[JRide] /api/live-location error", err);
    return NextResponse.json(
      {
        error: "Internal error while updating live location",
        details: String(err?.message ?? err)
      },
      { status: 500 }
    );
  }
}
