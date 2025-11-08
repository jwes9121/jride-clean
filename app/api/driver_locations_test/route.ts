import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase URL or SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// POST /api/driver_locations_test
// very dumb: delete then insert
export async function POST(req: Request) {
  try {
    const supabase = getClient();
    const body = await req.json().catch(() => ({}));

    const { driverId, lat, lng, status } = body || {};

    if (!driverId || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json(
        {
          error: "BAD_INPUT",
          got: { driverId, lat, lng, status },
        },
        { status: 400 }
      );
    }

    const normalizedStatus =
      typeof status === "string" && status.trim().length
        ? status
        : "online";

    const nowIso = new Date().toISOString();

    // delete existing
    const { error: delErr } = await supabase
      .from("driver_locations")
      .delete()
      .eq("driver_id", driverId);

    if (delErr) {
      console.error("[TEST] delete error", delErr);
    }

    // insert new
    const { error: insErr } = await supabase.from("driver_locations").insert({
      driver_id: driverId,
      lat,
      lng,
      status: normalizedStatus,
      updated_at: nowIso,
    });

    if (insErr) {
      console.error("[TEST] insert error", insErr);
      return NextResponse.json(
        {
          error: "TEST_DB_ERROR_INSERT",
          message: insErr.message,
          code: insErr.code,
          details: insErr.details,
          hint: insErr.hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("[TEST] unexpected", err);
    return NextResponse.json(
      {
        error: "TEST_UNEXPECTED",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

// GET /api/driver_locations_test
export async function GET() {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from("driver_locations")
      .select("driver_id, lat, lng, status, updated_at");

    if (error) {
      console.error("[TEST] select error", error);
      return NextResponse.json(
        {
          error: "TEST_DB_ERROR_SELECT",
          message: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ drivers: data }, { status: 200 });
  } catch (err: any) {
    console.error("[TEST] unexpected GET", err);
    return NextResponse.json(
      {
        error: "TEST_UNEXPECTED_GET",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
