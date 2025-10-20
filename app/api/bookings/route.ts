import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  // optional: role check
  // if (session.user.role !== "dispatcher" && session.user.role !== "admin") return new NextResponse("Forbidden", { status: 403 });

  return NextResponse.json({ ok: true });
}
