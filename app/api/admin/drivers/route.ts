import { NextResponse } from "next/server";

export async function GET() {
  // Temporary stub: no separate drivers table in prod yet.
  // Dispatch UI will fall back to showing assigned_driver_id codes.
  try {
    return NextResponse.json({
      drivers: [],
    });
  } catch (err: any) {
    console.error("DRIVERS_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "DRIVERS_UNEXPECTED_ERROR",
        message: err?.message ?? "Unexpected error while loading drivers.",
      },
      { status: 500 }
    );
  }
}
