import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!url || !key) {
    throw new Error("Missing SUPABASE env vars");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export async function GET(req: Request) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .not("status", "eq", "cancelled")
      .not("status", "eq", "completed")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({
        ok: false,
        error: error.message,
      }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      source: "page-data-route-fixed",
      trips: data ?? [],
      bookings: data ?? [],
      data: data ?? [],
      debug: {
        tripCount: data?.length ?? 0,
        rawRowCount: data?.length ?? 0,
        note: "using direct service role client",
      },
    });

  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message,
    }, { status: 500 });
  }
}