import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.replace("Bearer ", "").trim();
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json({ ok: false, error: "INVALID_TOKEN" }, { status: 401 });
    }

    const ACTIVE_STATUSES = [
      "requested",
      "assigned",
      "accepted",
      "fare_proposed",
      "ready",
      "on_the_way",
      "arrived",
      "on_trip"
    ];

    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("created_by_user_id", user.id)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      has_active_booking: !!data,
      booking: data || null
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "UNKNOWN_ERROR" },
      { status: 500 }
    );
  }
}
