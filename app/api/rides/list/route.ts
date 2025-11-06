import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const info = { hasUrl: !!url, srkLen: srk.length };

  if (!url || !srk) {
    return NextResponse.json({ status: "error", message: "Missing URL or SRK", info }, { status: 500 });
  }

  try {
    // Quick, direct REST probe first (helps isolate issues)
    const probe = await fetch(`${url}/rest/v1/rides?select=id&limit=1`, {
      headers: { apikey: srk, Authorization: `Bearer ${srk}` },
      cache: "no-store",
    });
    const probeText = await probe.text();

    // Now use supabase-js
    const supabase = createClient(url, srk);
    const { data, error } = await supabase.from("rides").select("*").limit(100);

    if (error) {
      return NextResponse.json({ status: "error", message: error.message, info, probeOk: probe.ok, probeText }, { status: 500 });
    }
    return NextResponse.json({ status: "ok", data, info, probeOk: probe.ok });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e.message, info }, { status: 500 });
  }
}
