// app/api/driver/ping/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Optional simple shared secret to protect this endpoint while testing
const PING_TOKEN = process.env.DRIVER_PING_TOKEN ?? "";

type Body = { driver_id: string; lat: number; lng: number };

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("x-driver-ping-token") ?? "";
    if (PING_TOKEN && auth !== PING_TOKEN) {
      return NextResponse.json({ status: "error", message: "unauthorized" }, { status: 401 });
    }

    const { driver_id, lat, lng } = (await req.json()) as Body;
    if (!driver_id || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ status: "error", message: "driver_id, lat, lng required" }, { status: 400 });
    }

    const resp = await fetch(`${URL}/rest/v1/rpc/set_driver_location`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SRK,
        Authorization: `Bearer ${SRK}`,
      },
      body: JSON.stringify({ p_driver_id: driver_id, p_lat: lat, p_lng: lng }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return NextResponse.json({ status: "error", message: err }, { status: 400 });
    }

    return NextResponse.json({ status: "ok" });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: String(e?.message ?? e) }, { status: 500 });
  }
}
