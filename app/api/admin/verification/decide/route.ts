import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  try {
    const supabase = adminSupabase();
    const body: any = await req.json().catch(() => ({}));

    const passenger_id = String(body?.passenger_id || "").trim();
    const decision = String(body?.decision || "").trim().toLowerCase();
    const admin_notes = String(body?.admin_notes || "").trim();

    if (!passenger_id) {
      return NextResponse.json({ ok: false, error: "passenger_id required" }, { status: 400 });
    }
    if (decision !== "approve" && decision !== "reject") {
      return NextResponse.json({ ok: false, error: "decision must be approve or reject" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const newStatus = decision === "approve" ? "approved" : "rejected";

    // Update verification request row
    const up = await supabase
      .from("passenger_verification_requests")
      .update({
        status: newStatus,
        reviewed_at: now,
        reviewed_by: "admin",
        admin_notes: admin_notes || null,
      })
      .eq("passenger_id", passenger_id)
      .select("*")
      .maybeSingle();

    if (up.error) {
      return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
    }

    // On approve: unlock passenger by updating auth metadata
    if (decision === "approve") {
      const u = await supabase.auth.admin.updateUserById(passenger_id, {
        user_metadata: { verified: true, night_allowed: true },
      });

      if (u.error) {
        return NextResponse.json({
          ok: true,
          request: up.data,
          warning: "Approved, but failed to update user metadata: " + String(u.error.message || "error"),
        });
      }
    }

    return NextResponse.json({ ok: true, request: up.data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || "error") }, { status: 500 });
  }
}