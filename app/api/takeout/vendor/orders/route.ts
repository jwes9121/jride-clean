import { NextRequest, NextResponse } from "next/server";

function isTakeoutEnabled() {
  return String(process.env.TAKEOUT_ENABLED || "0").trim() === "1";
}

function disabled() {
  return NextResponse.json(
    {
      ok: false,
      error: "TAKEOUT_DISABLED",
      message: "Takeout vendor actions are prepared but not enabled yet."
    },
    { status: 503 }
  );
}

export async function GET() {
  return NextResponse.json({ ok: true, enabled: isTakeoutEnabled(), orders: [] });
}

export async function POST(_req: NextRequest) {
  if (!isTakeoutEnabled()) return disabled();
  return NextResponse.json(
    {
      ok: false,
      error: "TAKEOUT_VENDOR_ACTIONS_NOT_WIRED",
      message: "Canonical takeout vendor order actions route is reserved for the takeout rollout."
    },
    { status: 501 }
  );
}