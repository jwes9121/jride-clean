// app/api/bookings/route.ts

import { NextResponse } from "next/server";
import { auth } from "@/configs/nextauth";

export async function GET() {
  // check session first â€” this shows dispatcher-only behavior later
  const session = await auth();

  if (!session || !session.user?.email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  // placeholder data response
  return NextResponse.json({
    ok: true,
    message: "bookings endpoint stub",
    user: {
      email: session.user.email,
      name: session.user.name ?? null,
    },
  });
}
