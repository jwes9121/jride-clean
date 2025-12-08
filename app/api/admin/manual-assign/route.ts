import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { booking_id, driver_id } = body as {
      booking_id: string;
      driver_id: string;
    };

    if (!booking_id || !driver_id) {
      return NextResponse.json(
        { success: false, error: "Missing booking_id or driver_id" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase
      .from("bookings")
      .update({
        assigned_driver_id: driver_id,
        status: "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id)
      .select("id, booking_code, status, assigned_driver_id")
      .single();

    if (error) {
      console.error("MANUAL_ASSIGN_DB_ERROR", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, booking: data },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("MANUAL_ASSIGN_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      { success: false, error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
