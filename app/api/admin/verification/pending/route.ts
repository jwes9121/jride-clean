import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/admin";

export async function GET() {
  const supabase = createClient();

  const q = await supabase
    .from("passenger_verification_requests")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (q.error) {
    return NextResponse.json({ ok: false, error: q.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, rows: q.data || [] });
}
