import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  try {
    // Call the Supabase function
    const { data, error } = await supabase.rpc("assign_nearest_driver_v2");

    if (error) {
      console.error("RPC ERROR:", error);
      return NextResponse.json(
        { error: "DB_ERROR_ASSIGN", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, result: data }, { status: 200 });
  } catch (err: any) {
    console.error("SERVER ERROR:", err);
    return NextResponse.json(
      { error: "SERVER_ERROR", message: err.message },
      { status: 500 }
    );
  }
}
