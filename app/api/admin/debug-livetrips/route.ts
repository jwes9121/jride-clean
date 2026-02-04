import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET() {
  try {
    const supabase = createClient(url, anon);

    const { data, error } = await supabase
      .from("admin_active_trips_v1")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      console.error("[debug-livetrips] error", error);
      return NextResponse.json(
        { ok: false, error: String(error) },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        rowCount: data?.length ?? 0,
        rows: data,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[debug-livetrips] exception", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
