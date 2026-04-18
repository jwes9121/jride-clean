import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

function isEmailInList(email: string | null | undefined, listLower: string[]) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return listLower.includes(e);
}

async function getAuthorizedAdmin() {
  const session = await auth();
  const requesterEmail = String((session?.user as any)?.email || "").trim().toLowerCase();
  const role = String((session?.user as any)?.role || "user").trim().toLowerCase();
  const hasUser = !!session?.user;

  if (!hasUser) {
    return { ok: false, status: 401, error: "Not signed in" };
  }

  const adminEmailsLower = toLowerList(parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS")));
  const dispatcherEmailsLower = toLowerList(parseCsv(env("JRIDE_DISPATCHER_EMAILS") || env("DISPATCHER_EMAILS")));

  const isAdmin = role === "admin" || isEmailInList(requesterEmail, adminEmailsLower);
  const isDispatcher = role === "dispatcher" || isEmailInList(requesterEmail, dispatcherEmailsLower);

  if (!isAdmin && !isDispatcher) {
    return { ok: false, status: 403, error: "Forbidden (admin/dispatcher only)." };
  }

  return {
    ok: true,
    requesterEmail,
    isAdmin,
    isDispatcher,
  };
}

function nowIso() {
  return new Date().toISOString();
}

export async function POST(req: Request) {
  try {
    const authz: any = await getAuthorizedAdmin();
    if (!authz.ok) {
      return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status });
    }

    const body = await req.json().catch(() => ({}));
    const passenger_id = body?.passenger_id ? String(body.passenger_id) : "";
    const decision = body?.decision ? String(body.decision) : "";
    const admin_notes = body?.admin_notes ? String(body.admin_notes) : null;

    if (!passenger_id) {
      return NextResponse.json({ ok: false, error: "Missing passenger_id" }, { status: 400 });
    }
    if (decision !== "approve" && decision !== "reject") {
      return NextResponse.json({ ok: false, error: "Invalid decision" }, { status: 400 });
    }

    if (decision === "approve" && !authz.isAdmin) {
      return NextResponse.json({ ok: false, error: "Forbidden (admin only)." }, { status: 403 });
    }

    const nextStatus = decision === "approve" ? "approved" : "rejected";

    const admin = supabaseAdmin();
    const upd = await admin
      .from("passenger_verification_requests")
      .update({
        status: nextStatus,
        reviewed_at: nowIso(),
        reviewed_by: authz.requesterEmail,
        admin_notes,
      })
      .eq("passenger_id", passenger_id)
      .in("status", ["submitted", "pending_admin"])
      .select("*")
      .single();

    if (upd.error) {
      return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 });
    }

    if (decision === "approve") {
      const u = await admin.auth.admin.updateUserById(passenger_id, {
        user_metadata: { verified: true, night_allowed: true },
      });

      if (u.error) {
        return NextResponse.json({
          ok: true,
          row: upd.data,
          warning: "Approved, but failed to update user metadata: " + String(u.error.message || "error"),
        });
      }
    }

    return NextResponse.json({ ok: true, row: upd.data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

