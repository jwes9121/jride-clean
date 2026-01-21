import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const SERVICE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, error: "Supabase env vars missing (SUPABASE_URL + SERVICE_ROLE/ANON key)" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Only select id (most compatible across schemas)
    const { data, error } = await supabase
      .from("drivers")
      .select("id")
      .limit(1000);

    if (error) return json(500, { ok: false, error: error.message });

    const drivers = (data || [])
      .map((r: any) => String(r?.id || "").trim())
      .filter((x: string) => x.length > 0);

    return json(200, { ok: true, drivers });
  } catch (e: any) {
    return json(500, { ok: false, error: e?.message || String(e) });
  }
}