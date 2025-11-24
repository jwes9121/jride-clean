// app/api/debug/supabase/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const url = process.env.SUPABASE_URL;
    const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

    const client = supabaseAdmin();
    const { data, error } = await client.from("driver_locations").select("id").limit(1);

    return NextResponse.json({
      url,
      hasKey,
      error: error ? { message: error.message, details: error.details } : null,
      data,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        url: process.env.SUPABASE_URL,
        hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        error: { message: err?.message, stack: err?.stack },
      },
      { status: 500 }
    );
  }
}
