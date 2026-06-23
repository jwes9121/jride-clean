import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      error: "RETRY_AUTO_ASSIGN_DISABLED",
      reason: "Blind retry auto-assign is disabled. Expired rides must reassign through /api/dispatch/assign with excluded driver id.",
    },
    { status: 409 }
  );
}
