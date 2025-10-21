export const dynamic = "force-dynamic"; // don’t prerender this at build
export const revalidate = 0;            // no ISR

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = getAdminClient();
  const { data, error } = await supabase.from("bookings").select("*").limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const payload = await req.json();
  const supabase = getAdminClient();
  const { data, error } = await supabase.from("bookings").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
