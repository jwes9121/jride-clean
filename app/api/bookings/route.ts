import { NextResponse } from "next/server";
import { auth } from "../../../auth";

export async function GET() {
  const session = await auth();

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // replace this with real data if you already had logic
  return NextResponse.json(
    { ok: true, user: session.user },
    { status: 200 }
  );
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await request.json();

  // TODO: create booking in DB / Supabase

  return NextResponse.json(
    { ok: true, received: body, user: session.user },
    { status: 200 }
  );
}
