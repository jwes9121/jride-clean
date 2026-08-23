import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(status: number, payload: Record<string, any>) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function adminClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function minuteStartIso(now: Date): string {
  const value = new Date(now);
  value.setUTCSeconds(0, 0);
  return value.toISOString();
}

export async function POST(req: NextRequest) {
  const admin = adminClient();
  if (!admin) {
    return json(500, { ok: false, error: "SERVER_MISCONFIG" });
  }

  const body = await req.json().catch(() => ({} as any));
  const vendorId = clean(body?.vendor_id || body?.vendorId);
  const client = clean(body?.client || "web").slice(0, 40) || "web";

  if (!vendorId) {
    return json(400, {
      ok: false,
      error: "VENDOR_ID_REQUIRED",
      message: "vendor_id is required.",
    });
  }

  const vendorRes = await admin
    .from("vendor_accounts")
    .select("id,accepting_orders")
    .eq("id", vendorId)
    .limit(1)
    .maybeSingle();

  if (vendorRes.error) {
    return json(500, {
      ok: false,
      error: "VENDOR_READ_FAILED",
      message: vendorRes.error.message,
    });
  }

  if (!vendorRes.data) {
    return json(404, {
      ok: false,
      error: "VENDOR_NOT_FOUND",
      message: "Vendor account was not found.",
    });
  }

  const availability = await admin.rpc("vendor_effective_availability", {
    p_vendor_id: vendorRes.data.id,
  });

  if (availability.error) {
    return json(500, {
      ok: false,
      error: "VENDOR_AVAILABILITY_READ_FAILED",
      message: availability.error.message,
    });
  }

  const availabilityRow = Array.isArray(availability.data)
    ? availability.data[0]
    : availability.data;
  const effectiveAcceptingOrders = availabilityRow
    ? availabilityRow.effective_accepting_orders === true
    : vendorRes.data.accepting_orders === true;

  const now = new Date();
  const row = {
    vendor_id: vendorId,
    minute_started_at: minuteStartIso(now),
    last_seen_at: now.toISOString(),
    accepting_orders: effectiveAcceptingOrders,
    client,
  };

  const upsert = await admin
    .from("vendor_presence_minutes")
    .upsert(row, { onConflict: "vendor_id,minute_started_at" });

  if (upsert.error) {
    return json(500, {
      ok: false,
      error: "PRESENCE_WRITE_FAILED",
      message: upsert.error.message,
    });
  }

  return json(200, {
    ok: true,
    vendor_id: vendorId,
    accepting_orders: row.accepting_orders,
    availability_reason: clean(availabilityRow?.reason || ""),
    recorded_at: row.last_seen_at,
    online_until: new Date(now.getTime() + 120000).toISOString(),
  });
}
