import { NextRequest, NextResponse } from "next/server";

function isTakeoutEnabled() {
  return String(process.env.TAKEOUT_ENABLED || "0").trim() === "1";
}

function disabled() {
  return NextResponse.json(
    {
      ok: false,
      error: "TAKEOUT_DISABLED",
      message: "Takeout is prepared but not enabled yet."
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
      error: "TAKEOUT_ORDER_CREATE_NOT_WIRED",
      message: "Canonical takeout order create route is reserved for the takeout rollout."
    },
    { status: 501 }
  );
}