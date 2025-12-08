import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  return createClient(url, key);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const fromZoneId = body.from_zone_id as string | undefined;
    const toZoneId = body.to_zone_id as string | undefined;
    const moveCountRaw = body.move_count;

    const moveCount = Number(moveCountRaw ?? 0);
    if (!fromZoneId || !toZoneId || !moveCount || moveCount <= 0) {
      return NextResponse.json(
        { error: "from_zone_id, to_zone_id and positive move_count are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Select drivers to move
    const { data: drivers, error: selError } = await supabase
      .from("drivers")
      .select("id")
      .eq("zone_id", fromZoneId)
      .eq("driver_status", "online")
      .limit(moveCount);

    if (selError) {
      console.error("rebalance select error:", selError);
      return NextResponse.json(
        { error: selError.message },
        { status: 500 }
      );
    }

    if (!drivers || drivers.length === 0) {
      return NextResponse.json(
        { error: "No online drivers found in source zone" },
        { status: 400 }
      );
    }

    const ids = drivers.map((d) => d.id);

    const { error: updError } = await supabase
      .from("drivers")
      .update({ zone_id: toZoneId })
      .in("id", ids);

    if (updError) {
      console.error("rebalance update error:", updError);
      return NextResponse.json(
        { error: updError.message },
        { status: 500 }
      );
    }

    await supabase.rpc("refresh_zone_capacity");

    return NextResponse.json({ ok: true, moved: ids.length });
  } catch (err: any) {
    console.error("rebalance unexpected error:", err);
    return NextResponse.json(
      { error: err.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
