import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function sbPOST(url: string, srk: string, path: string, body: any) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      apikey: srk,
      Authorization: `Bearer ${srk}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

async function sbGET(url: string, srk: string, path: string) {
  const res = await fetch(`${url}${path}`, {
    headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingCode = String(body?.bookingCode || "").trim();
    const toDriverId = String(body?.toDriverId || "").trim();
    const reason = String(body?.reason || "auto_reassign").trim();
    const createdBy = String(body?.createdBy || "admin").trim();

    if (!bookingCode) return NextResponse.json({ error: "bookingCode required" }, { status: 400 });
    if (!toDriverId) return NextResponse.json({ error: "toDriverId required" }, { status: 400 });

    const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
    const srk = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    // resolve booking id by code
    const b = await sbGET(url, srk,
      `/rest/v1/bookings?select=id&booking_code=eq.${encodeURIComponent(bookingCode)}&limit=1`
    );
    const bookingId = b?.[0]?.id;
    if (!bookingId) return NextResponse.json({ error: `booking not found: ${bookingCode}` }, { status: 404 });

    // call your guarded SQL function
    const result = await sbPOST(url, srk, `/rest/v1/rpc/admin_reassign_driver`, {
      p_booking_id: bookingId,
      p_to_driver_id: toDriverId,
      p_reason: reason,
      p_created_by: createdBy,
    });

    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
