import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { booking_id, status } = body as {
      booking_id: string;
      status: string;
    };

    if (!booking_id || !status) {
      return NextResponse.json(
        { success: false, error: "Missing booking_id or status" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const updates: any = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === "completed") {
      updates.assigned_driver_id = null;
    }

    const { data, error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", booking_id)
      .select("id, booking_code, status, assigned_driver_id")
      .single();

    if (error) {
      console.error("UPDATE_TRIP_STATUS_DB_ERROR", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log("UPDATE_TRIP_STATUS_OK", data);

    return NextResponse.json(
      { success: true, booking: data },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("UPDATE_TRIP_STATUS_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      { success: false, error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
