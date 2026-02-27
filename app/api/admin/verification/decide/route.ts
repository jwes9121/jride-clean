import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
}

function parseCsv(v: string) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toLowerList(xs: string[]) {
  return xs.map((s) => s.trim().toLowerCase()).filter(Boolean);
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

async function isRequesterAdmin(adminSb: any, userId: string, email: string) {
  const adminIds = parseCsv(env("ADMIN_USER_IDS") || env("JRIDE_ADMIN_USER_IDS"));
  const adminEmailsLower = toLowerList(parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS")));

  if (isInList(userId, adminIds)) return true;
  if (isEmailInList(email, adminEmailsLower)) return true;

  try {
    const u = await adminSb.auth.admin.getUserById(userId);
    const md: any = u?.data?.user?.user_metadata || {};
    const role = String(md?.role || "").toLowerCase();
    if (md?.is_admin === true) return true;
    if (role === "admin") return true;
  } catch {}

  return false;
}

export async function POST(req: Request) {
  try {
    const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
    const anon =
      env("SUPABASE_ANON_KEY") ||
      env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
      env("NEXT_PUBLIC_SUPABASE_KEY");
    const service =
      env("SUPABASE_SERVICE_ROLE_KEY") ||
      env("SUPABASE_SERVICE_ROLE") ||
      env("SUPABASE_SERVICE_KEY");

    if (!url) return NextResponse.json({ ok: false, error: "Missing SUPABASE_URL" }, { status: 500 });
    if (!anon) return NextResponse.json({ ok: false, error: "Missing SUPABASE_ANON_KEY" }, { status: 500 });
    if (!service) {
      return NextResponse.json(
        { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    // 1) Supabase cookie session (who is calling)
    const cookieStore = cookies();
    const userSb = createServerClient(url, anon, {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
      },
    });

    const { data: userData } = await userSb.auth.getUser();
    const user = userData?.user;

    const requesterId = user?.id ? String(user.id) : "";
    const requesterEmail = user?.email ? String(user.email) : "";

    if (!requesterId) {
      return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    }

    // 2) Admin/service client (privileged DB + auth admin)
    const adminSb = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const okAdmin = await isRequesterAdmin(adminSb, requesterId, requesterEmail);
    if (!okAdmin) {
      return NextResponse.json({ ok: false, error: "Forbidden (admin only)." }, { status: 403 });
    }

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

    const up = await adminSb
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
      const u = await adminSb.auth.admin.updateUserById(passenger_id, {
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