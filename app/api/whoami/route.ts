// app/api/whoami/route.ts

import { NextResponse } from "next/server";
import { auth } from "@/configs/nextauth";

export async function GET() {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ authenticated: false, user: null });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      email: session.user?.email ?? null,
      name: session.user?.name ?? null,
      image: session.user?.image ?? null,
    },
  });
}
