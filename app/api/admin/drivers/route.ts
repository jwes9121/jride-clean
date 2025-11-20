import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("drivers")
      .select(
        `
        driver_id,
        full_name,
        town,
        vehicle_type,
        plate_number,
        is_active
      `
      )
      .order("driver_id", { ascending: true });

    if (error) {
      console.error("DRIVERS_DB_ERROR", error);
      return NextResponse.json(
        {
          error: "DRIVERS_DB_ERROR",
          message: error.message,
        },
        { status: 500 }
      );
    }

    const drivers = (data ?? []).filter((d: any) => d.is_active !== false);

    return NextResponse.json({
      drivers,
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
