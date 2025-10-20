import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { computeTricycleFare } from "@/lib/fare";
import { supabaseAdmin } from "@/lib/supabase-admin";

type CreateBookingBody = {
  mode?: "tricycle" | "motorcycle";
  passengers?: number; // sent by client, but we validate again
  fare?: unknown;      // ignored; we recompute on server
  source?: string;
  // TODO: pickup/dropoff fields when you’re ready
};

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as CreateBookingBody;
    const mode = body.mode ?? "tricycle";
    const passengersRaw = Number(body.passengers ?? 1);

    // Server-side safety: clamp + validate
    const passengers =
      mode === "motorcycle"
        ? 1
        : Math.max(1, Math.min(4, Math.floor(isFinite(passengersRaw) ? passengersRaw : 1)));

    if (mode === "motorcycle" && passengers !== 1) {
      return NextResponse.json(
        { error: "Motorcycle rides are limited to one (1) passenger." },
        { status: 400 }
      );
    }

    // Recompute fare on server (ignore client fare)
    const fare = computeTricycleFare(passengers);

    // Insert into Supabase (admin client, server-only)
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .insert({
        mode,
        passengers,
        base_fare: fare.base,
        add_passengers: fare.addPassengers,
        convenience_fee: fare.convenienceFee,
        total: fare.total,
        status: "pending",
        // Minimal identity — use email for now; later map to your users table
        user_email: session.user.email,
        source: body.source ?? "web",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[bookings.insert] ", error);
      return NextResponse.json(
        { error: "Failed to create booking." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { id: data?.id, total: fare.total, passengers },
      { status: 201 }
    );
  } catch (e: any) {
    console.error("[bookings.POST] ", e);
    return NextResponse.json(
      { error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  // optional: return a simple health check
  return NextResponse.json({ ok: true });
}
