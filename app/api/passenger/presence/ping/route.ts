import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PresenceBody = {
  passenger_id?: string | null;
  passenger_name?: string | null;
  town?: string | null;
  app_state?: string | null;
  screen_name?: string | null;
  last_booking_code?: string | null;
  platform?: string | null;
};

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeAppState(v: unknown): "foreground" | "background" | "offline" {
  const s = text(v).toLowerCase();
  if (s === "background") return "background";
  if (s === "offline") return "offline";
  return "foreground";
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const body = (await req.json().catch(() => ({}))) as PresenceBody;

    const passengerId =
      text(body.passenger_id) ||
      text((session?.user as any)?.id) ||
      text((session?.user as any)?.user_id);

    if (!passengerId) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED", message: "Passenger identity is required." },
        { status: 401 }
      );
    }

    const passengerName =
      text(body.passenger_name) ||
      text((session?.user as any)?.name) ||
      text((session?.user as any)?.full_name);

    const town = text(body.town) || null;
    const appState = normalizeAppState(body.app_state);
    const screenName = text(body.screen_name) || null;
    const lastBookingCode = text(body.last_booking_code) || null;
    const platform = text(body.platform) || "android";

    const admin = supabaseAdmin();

    const nowIso = new Date().toISOString();

    const { error } = await admin
      .from("passenger_app_presence")
      .upsert(
        {
          passenger_id: passengerId,
          passenger_name: passengerName || null,
          town,
          app_state: appState,
          screen_name: screenName,
          last_seen_at: nowIso,
          last_booking_code: lastBookingCode,
          platform,
        },
        { onConflict: "passenger_id" }
      );

    if (error) {
      return NextResponse.json(
        { ok: false, error: "PRESENCE_UPSERT_FAILED", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      passenger_id: passengerId,
      app_state: appState,
      screen_name: screenName,
      town,
      platform,
      last_seen_at: nowIso,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "PRESENCE_PING_FAILED", message: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
