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

    const bookingResults = uniqueByBookingId(rows);

    const agriRows: any[] = [];
    const agriTextSearch = await supabase
      .from("agrimarket_orders")
      .select("id, order_code, status, customer_user_id, producer_id, assigned_driver_id, delivery_label, created_at, updated_at")
      .or([
        "order_code.ilike." + pattern,
        "delivery_label.ilike." + pattern,
        "status.ilike." + pattern,
      ].join(","))
      .order("updated_at", { ascending: false })
      .limit(25);

    if (agriTextSearch.error) {
      return NextResponse.json(
        { ok: false, error: "AGRIMARKET_SEARCH_FAILED", message: agriTextSearch.error.message },
        { status: 500 }
      );
    }

    if (Array.isArray(agriTextSearch.data)) agriRows.push(...agriTextSearch.data);

    if (isUuid(q)) {
      const agriUuidSearch = await supabase
        .from("agrimarket_orders")
        .select("id, order_code, status, customer_user_id, producer_id, assigned_driver_id, delivery_label, created_at, updated_at")
        .or([
          "id.eq." + q,
          "customer_user_id.eq." + q,
          "producer_id.eq." + q,
          "assigned_driver_id.eq." + q,
          "delivery_booking_id.eq." + q,
        ].join(","))
        .order("updated_at", { ascending: false })
        .limit(25);

      if (agriUuidSearch.error) {
        return NextResponse.json(
          { ok: false, error: "AGRIMARKET_UUID_SEARCH_FAILED", message: agriUuidSearch.error.message },
          { status: 500 }
        );
      }

      if (Array.isArray(agriUuidSearch.data)) agriRows.push(...agriUuidSearch.data);
    }

    const seenAgri = new Set<string>();
    const normalizedAgri = agriRows
      .filter((row) => {
        const key = String(row?.id || row?.order_code || "");
        if (!key || seenAgri.has(key)) return false;
        seenAgri.add(key);
        return true;
      })
      .map((row) => ({
        id: row?.id ?? null,
        booking_code: row?.order_code ?? null,
        passenger_name: null,
        from_label: null,
        to_label: row?.delivery_label ?? null,
        town: null,
        status: row?.status ?? null,
        service_type: "agrimarket",
        trip_type: "agrimarket",
        driver_id: row?.assigned_driver_id ?? null,
        assigned_driver_id: row?.assigned_driver_id ?? null,
        vendor_id: row?.producer_id ?? null,
        created_by_user_id: row?.customer_user_id ?? null,
        created_at: row?.created_at ?? null,
        updated_at: row?.updated_at ?? null,
      }));

    const bookings = [...bookingResults, ...normalizedAgri]
      .sort((a: any, b: any) => {
        const at = Date.parse(String(a?.updated_at || a?.created_at || "")) || 0;
        const bt = Date.parse(String(b?.updated_at || b?.created_at || "")) || 0;
        return bt - at;
      })
      .slice(0, 25);

    return NextResponse.json({
      ok: true,
      query: q,
      total: bookings.length,
      bookings,
      note: "Service-aware search covers bookings plus AgriMarket order codes and identifiers.",
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
