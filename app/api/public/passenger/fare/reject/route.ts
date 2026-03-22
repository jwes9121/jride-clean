import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const booking_id = body?.booking_id;
    if (!booking_id) {
      return NextResponse.json({ ok: false, error: "Missing booking_id" }, { status: 400 });
    }

    // Forward to canonical route
    const res = await fetch(process.env.INTERNAL_BASE_URL + "/api/rides/fare-response", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        booking_code: body.booking_code,
        action: "reject"
      }),
    });

    const json = await res.json();

    return NextResponse.json(json, { status: res.status });

  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: String(e?.message || e)
    }, { status: 500 });
  }
}
