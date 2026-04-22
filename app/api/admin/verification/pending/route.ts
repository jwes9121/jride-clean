import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

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

function toLower(xs: string[]) {
  return xs.map((s) => s.toLowerCase());
}

function has(list: string[], value: string) {
  return list.includes(String(value || "").trim());
}

function hasEmail(list: string[], value: string) {
  return list.includes(String(value || "").trim().toLowerCase());
}

export async function GET() {
  try {
    const session = await auth();

    const requesterId = String(session?.user?.id || "");
    const requesterEmail = String(session?.user?.email || "").toLowerCase();

    if (!requesterId) {
      return NextResponse.json(
        { ok: false, error: "Not signed in" },
        { status: 401 }
      );
    }

    const url =
      env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");

    const service =
      env("SUPABASE_SERVICE_ROLE_KEY") ||
      env("SUPABASE_SERVICE_ROLE") ||
      env("SUPABASE_SERVICE_KEY");

    if (!url || !service) {
      return NextResponse.json(
        { ok: false, error: "Missing Supabase env" },
        { status: 500 }
      );
    }

    const adminSb = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const adminIds = parseCsv(
      env("JRIDE_ADMIN_USER_IDS") || env("ADMIN_USER_IDS")
    );

    const dispatcherIds = parseCsv(
      env("JRIDE_DISPATCHER_USER_IDS") || env("DISPATCHER_USER_IDS")
    );

    const adminEmails = toLower(
      parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS"))
    );

    const dispatcherEmails = toLower(
      parseCsv(
        env("JRIDE_DISPATCHER_EMAILS") || env("DISPATCHER_EMAILS")
      )
    );

    const allowed =
      has(adminIds, requesterId) ||
      has(dispatcherIds, requesterId) ||
      hasEmail(adminEmails, requesterEmail) ||
      hasEmail(dispatcherEmails, requesterEmail);

    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const submittedRowsRes = await adminSb
      .from("passenger_verification_requests")
      .select("*")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: true });

    const pendingRowsRes = await adminSb
      .from("passenger_verification_requests")
      .select("*")
      .eq("status", "pending_admin")
      .order("submitted_at", { ascending: true });

    if (submittedRowsRes.error) {
      return NextResponse.json(
        { ok: false, error: submittedRowsRes.error.message },
        { status: 500 }
      );
    }

    if (pendingRowsRes.error) {
      return NextResponse.json(
        { ok: false, error: pendingRowsRes.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      rows: {
        submitted: submittedRowsRes.data || [],
        pending_admin: pendingRowsRes.data || [],
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "SERVER_ERROR" },
      { status: 500 }
    );
  }
}