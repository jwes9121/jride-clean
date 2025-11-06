import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  const info = {
    hasUrl: !!url,
    srkLen: srk.length,
    urlProjectRef: url.split("https://")[1]?.split(".")[0] || null, // quick ref check
  };

  if (!url || !srk) {
    return NextResponse.json({ status: "error", message: "Missing URL or SRK", info }, { status: 500 });
  }

  try {
    // Direct REST probe with SRK
    const probe = await fetch(`${url}/rest/v1/rides?select=id&limit=1`, {
      headers: { apikey: srk, Authorization: `Bearer ${srk}` },
      cache: "no-store",
    });
    const probeText = await probe.text();

    if (!probe.ok) {
      return NextResponse.json(
        { status: "error", message: "REST probe failed", info, probeOk: false, probeText },
        { status: 500 },
      );
    }

    // Success
    return NextResponse.json({ status: "ok", info, probeOk: true, preview: probeText });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e.message, info }, { status: 500 });
  }
}
