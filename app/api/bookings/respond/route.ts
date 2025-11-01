export const dynamic = "force-dynamic"; // never pre-render or collect page data here
export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  // simple health check
  return NextResponse.json({ ok: true, route: "/api/bookings/respond" });
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));

    // TODO: implement your booking response logic here (e.g., Supabase update)
    // Example (pseudo):
    //   const { id, action } = payload;
    //   await supabase.from("bookings").update({ status: action }).eq("id", id);

    return NextResponse.json({ ok: true, received: payload });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
