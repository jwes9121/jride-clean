import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRole) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isStaffRole(role: unknown): boolean {
  const r = String(role || "").toLowerCase();
  return r === "admin" || r === "dispatcher";
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function escapeIlike(v: string): string {
  return v.replace(/[%_,]/g, "");
}

function uniqueByBookingId(rows: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];

  for (const row of rows) {
    const key = String(row?.id || row?.booking_code || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

const BOOKING_SELECT = [
  "id",
  "booking_code",
  "passenger_name",
  "from_label",
  "to_label",
  "town",
  "status",
  "service_type",
  "trip_type",
  "driver_id",
  "assigned_driver_id",
  "vendor_id",
  "created_by_user_id",
  "created_at",
  "updated_at",
  "completed_at",
  "company_cut",
  "wallet_settlement_status",
].join(", ");

export async function GET(req: NextRequest) {
  const session = await auth();
  const sessionUser = (session?.user ?? null) as any;
  const role = String(sessionUser?.role || "").toLowerCase();

  if (!sessionUser) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED", message: "Sign in required." }, { status: 401 });
  }

  if (!isStaffRole(role)) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Admin or dispatcher role required." }, { status: 403 });
  }

  const q = text(req.nextUrl.searchParams.get("q"));
  if (!q) {
    return NextResponse.json({ ok: false, error: "MISSING_QUERY", message: "Search query is required." }, { status: 400 });
  }

  if (q.length < 2) {
    return NextResponse.json({ ok: false, error: "QUERY_TOO_SHORT", message: "Use at least 2 characters." }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    const cleaned = escapeIlike(q);
    const pattern = "%" + cleaned + "%";
    const rows: any[] = [];

    const textSearch = await supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .or([
        "booking_code.ilike." + pattern,
        "passenger_name.ilike." + pattern,
        "town.ilike." + pattern,
        "from_label.ilike." + pattern,
        "to_label.ilike." + pattern,
        "status.ilike." + pattern,
        "service_type.ilike." + pattern,
      ].join(","))
      .order("updated_at", { ascending: false })
      .limit(25);

    if (textSearch.error) {
      return NextResponse.json({ ok: false, error: "BOOKING_SEARCH_FAILED", message: textSearch.error.message }, { status: 500 });
    }

    if (Array.isArray(textSearch.data)) rows.push(...textSearch.data);

    if (isUuid(q)) {
      const uuidSearch = await supabase
        .from("bookings")
        .select(BOOKING_SELECT)
        .or([
          "id.eq." + q,
          "driver_id.eq." + q,
          "assigned_driver_id.eq." + q,
          "vendor_id.eq." + q,
          "created_by_user_id.eq." + q,
        ].join(","))
        .order("updated_at", { ascending: false })
        .limit(25);

      if (uuidSearch.error) {
        return NextResponse.json({ ok: false, error: "UUID_SEARCH_FAILED", message: uuidSearch.error.message }, { status: 500 });
      }

      if (Array.isArray(uuidSearch.data)) rows.push(...uuidSearch.data);
    }

    const bookings = uniqueByBookingId(rows).slice(0, 25);

    return NextResponse.json({
      ok: true,
      query: q,
      total: bookings.length,
      bookings,
      note: "V1 searches confirmed bookings columns only. It does not assume passenger, driver, or vendor table schemas.",
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "LIVETRIPS_SEARCH_FAILED",
        message: String(err?.message ?? err),
      },
      { status: 500 }
    );
  }
}
