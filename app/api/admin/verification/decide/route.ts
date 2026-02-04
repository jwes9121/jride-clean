import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@supabase/supabase-js";

function parseCsv(v: string) {
  return String(v || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function toLowerList(xs: string[]) {
  return xs.map(s => s.trim().toLowerCase()).filter(Boolean);
}

function isInList(val: string | null | undefined, list: string[]) {
  const v = String(val || "").trim();
  if (!v) return false;
  return list.includes(v);
}

function isEmailInList(email: string | null | undefined, listLower: string[]) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return listLower.includes(e);
}

function adminSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function isRequesterAdmin(supabase: any, userId: string, email: string) {
  const adminIds = parseCsv(process.env.ADMIN_USER_IDS || process.env.JRIDE_ADMIN_USER_IDS || "");
  const adminEmailsLower = toLowerList(parseCsv(process.env.JRIDE_ADMIN_EMAILS || process.env.ADMIN_EMAILS || ""));

  if (isInList(userId, adminIds)) return true;
  if (isEmailInList(email, adminEmailsLower)) return true;

  try {
    const u = await supabase.auth.admin.getUserById(userId);
    const md: any = u?.data?.user?.user_metadata || {};
    const role = String(md?.role || "").toLowerCase();
    if (md?.is_admin === true) return true;
    if (role === "admin") return true;
  } catch {}

  return false;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const requesterId = session?.user?.id ? String(session.user.id) : "";
    const requesterEmail = session?.user?.email ? String(session.user.email) : "";

    if (!requesterId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

    const supabase = adminSupabase();

    const okAdmin = await isRequesterAdmin(supabase, requesterId, requesterEmail);
    if (!okAdmin) return NextResponse.json({ ok: false, error: "Forbidden (admin only)." }, { status: 403 });

    const body: any = await req.json().catch(() => ({}));
    const passenger_id = String(body?.passenger_id || "").trim();
    const decision = String(body?.decision || "").trim().toLowerCase();
    const admin_notes = String(body?.admin_notes || "").trim();

    if (!passenger_id) return NextResponse.json({ ok: false, error: "passenger_id required" }, { status: 400 });
    if (decision !== "approve" && decision !== "reject") {
      return NextResponse.json({ ok: false, error: "decision must be approve or reject" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const newStatus = decision === "approve" ? "approved" : "rejected";

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

    if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });

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
