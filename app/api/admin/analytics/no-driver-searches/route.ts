import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXCLUDED_PASSENGER_NAMES = new Set([
  "che er",
  "je wes",
]);

type FailureRow = {
  id: string | null;
  created_at: string | null;
  passenger_id: string | null;
  passenger_name: string | null;
  town: string | null;
  from_label: string | null;
  to_label: string | null;
  requested_vehicle_type: string | null;
  alternate_vehicle_type: string | null;
  code: string | null;
  message: string | null;
  local_requested_count: number | null;
  local_alternate_count: number | null;
  emergency_requested_count: number | null;
  emergency_alternate_count: number | null;
};

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeTown(v: unknown): string {
  const s = text(v);
  return s || "Unknown";
}

function isExcludedPassenger(name: unknown): boolean {
  const s = text(name).toLowerCase();
  return !!s && EXCLUDED_PASSENGER_NAMES.has(s);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "100");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    const { data, error } = await supabase
      .from("driver_search_failures")
      .select("id, created_at, passenger_id, passenger_name, town, from_label, to_label, requested_vehicle_type, alternate_vehicle_type, code, message, local_requested_count, local_alternate_count, emergency_requested_count, emergency_alternate_count")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ ok: false, error: "NO_DRIVER_FAILURES_QUERY_FAILED", message: error.message }, { status: 500 });
    }

    const rows = (Array.isArray(data) ? (data as FailureRow[]) : [])
      .filter((r) => !isExcludedPassenger(r.passenger_name))
      .map((r) => ({
        id: r.id,
        created_at: r.created_at,
        passenger_id: r.passenger_id,
        passenger_name: text(r.passenger_name) || "Unknown Passenger",
        town: normalizeTown(r.town),
        from_label: text(r.from_label) || "-",
        to_label: text(r.to_label) || "-",
        requested_vehicle_type: text(r.requested_vehicle_type) || "-",
        alternate_vehicle_type: text(r.alternate_vehicle_type) || "-",
        code: text(r.code) || "NO_DRIVERS_AVAILABLE",
        message: text(r.message) || "No available drivers found.",
        local_requested_count: Number(r.local_requested_count || 0),
        local_alternate_count: Number(r.local_alternate_count || 0),
        emergency_requested_count: Number(r.emergency_requested_count || 0),
        emergency_alternate_count: Number(r.emergency_alternate_count || 0),
      }));

    const totals = rows.reduce(
      (acc, row) => {
        acc.total_failures += 1;
        const town = row.town;
        acc.by_town[town] = (acc.by_town[town] || 0) + 1;
        return acc;
      },
      { total_failures: 0, by_town: {} as Record<string, number> }
    );

    return NextResponse.json({ ok: true, rows, totals });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "NO_DRIVER_FAILURES_FAILED" }, { status: 500 });
  }
}
