export const runtime = "nodejs";
import { NextResponse } from "next/server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY || ""; // LEGACY

function auth() {
  return { apikey: SRK, Authorization: `Bearer ${SRK}` };
}

export async function GET() {
  if (!URL || !SRK) {
    return NextResponse.json(
      { status: "error", message: "Missing URL or SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  // Server-side REST using service_role (bypasses RLS)
  const res = await fetch(`${URL}/rest/v1/rides?select=*&limit=100`, {
    headers: auth(),
    cache: "no-store",
  });

  const txt = await res.text();
  if (!res.ok) return NextResponse.json({ status: "error", body: txt }, { status: 500 });

  try { return NextResponse.json({ status: "ok", data: JSON.parse(txt) }); }
  catch { return NextResponse.json({ status: "ok", raw: txt }); }
}
