// app/api/rides/complete/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Body = { ride_id: string };

export async function POST(req: Request) {
  try {
    const { ride_id } = (await req.json()) as Body;
    if (!ride_id) {
      return NextResponse.json({ status: "error", message: "ride_id required" }, { status: 400 });
    }

    const resp = await fetch(`${URL}/rest/v1/rpc/complete_ride_and_free_driver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SRK,
        Authorization: `Bearer ${SRK}`,
      },
      body: JSON.stringify({ p_ride_id: ride_id }),
    });

    const data = await resp.json();
    return NextResponse.json(data, { status: resp.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: String(e?.message ?? e) }, { status: 500 });
  }
}
