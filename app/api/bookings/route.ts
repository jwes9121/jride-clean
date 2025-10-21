// app/api/bookings/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // don’t attempt to prerender

export async function POST(req: Request) {
  const supabase = getSupabaseServer(); // <-- created here, not at import time
  const body = await req.json();
  // ... use supabase
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const supabase = getSupabaseServer();
  // ...
  return NextResponse.json({ ok: true });
}
