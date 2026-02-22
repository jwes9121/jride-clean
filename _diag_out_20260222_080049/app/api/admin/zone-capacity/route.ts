import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createClient(url, anonKey);

    const { data, error } = await supabase
      .from("zone_capacity_view")
      .select("*")
      .order("zone");

    if (error) {
      console.error("[zone-capacity] error", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (err: any) {
    console.error("[zone-capacity] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
