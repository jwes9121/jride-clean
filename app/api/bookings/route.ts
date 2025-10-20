import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { computeTricycleFare } from "@/lib/fare";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type CreateBookingBody = { mode?: "tricycle" | "motorcycle"; passengers?: number; source?: string; };

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as CreateBookingBody;
    const mode = body.mode ?? "tricycle";
    const passengersRaw = Number(body.passengers ?? 1);
    const passengers = mode === "motorcycle" ? 1 : Math.max(1, Math.min(4, Math.floor(isFinite(passengersRaw) ? passengersRaw : 1)));
    if (mode === "motorcycle" && passengers !== 1) return NextResponse.json({ error: "Motorcycle rides are limited to one (1) passenger." }, { status: 400 });

    const fare = computeTricycleFare(passengers);

    // Lazily import and create the client ONLY now
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only
    if (!url || !key) {
      return NextResponse.json({ error: "Server misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
    }
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data, error } = await supabase
      .from("bookings")
      .insert({
        mode, passengers,
        base_fare: fare.base, add_passengers: fare.addPassengers, convenience_fee: fare.convenienceFee, total: fare.total,
        status: "pending", user_email: session.user.email, source: body.source ?? "web",
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: "Failed to create booking." }, { status: 500 });
    return NextResponse.json({ id: data?.id, total: fare.total, passengers }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
