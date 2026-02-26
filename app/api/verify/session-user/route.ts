import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";

// Ensure request is not cached/static
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();

    const email = session?.user?.email ?? null;
    const name = session?.user?.name ?? null;

    // Debug info (safe): tells us if auth() worked at all
    if (!email) {
      return NextResponse.json(
        {
          ok: false,
          reason: "no_session_email",
          debug: {
            hasSession: !!session,
            userKeys: session?.user ? Object.keys(session.user) : [],
            namePresent: !!name,
          },
        },
        { status: 200 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRole) {
      return NextResponse.json(
        {
          ok: false,
          reason: "missing_env",
          needs: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
        },
        { status: 200 }
      );
    }

    // Supabase Admin API list users, then match email
    const url = `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`;
    const r = await fetch(url, {
      method: "GET",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json(
        { ok: false, reason: "admin_api_error", status: r.status, body: t },
        { status: 200 }
      );
    }

    const users = await r.json();
    const arr = Array.isArray(users) ? users : (users?.users || []);
    const u = Array.isArray(arr)
      ? arr.find((x: any) => (x?.email || "").toLowerCase() === email.toLowerCase())
      : null;

    if (!u?.id) {
      return NextResponse.json(
        { ok: false, reason: "no_supabase_user_for_email", email },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: true, email, supabase_user_id: u.id },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, reason: "exception", message: String(e?.message || e) },
      { status: 200 }
    );
  }
}