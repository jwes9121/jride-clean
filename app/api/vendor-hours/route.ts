import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MANILA_TIME_ZONE = "Asia/Manila";
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type Json = Record<string, any>;

function json(status: number, payload: Json) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hhmm(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function manilaDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return year && month && day ? `${year}-${month}-${day}` : "";
}

async function resolveVendor(admin: any, vendorKey: string) {
  // Some founding-pilot/test vendors use legacy UUID-shaped IDs that are valid
  // database keys but do not satisfy the RFC UUID variant bits. Always try the
  // exact primary key first instead of rejecting those IDs client-side.
  const byId = await admin
    .from("vendor_accounts")
    .select("*")
    .eq("id", vendorKey)
    .limit(1)
    .maybeSingle();
  if (!byId.error && byId.data) return byId.data;

  const byEmail = await admin
    .from("vendor_accounts")
    .select("*")
    .eq("email", vendorKey)
    .limit(1)
    .maybeSingle();
  if (!byEmail.error && byEmail.data) return byEmail.data;

  return null;
}

async function readStatus(admin: any, vendor: any) {
  const rpc = await admin.rpc("vendor_effective_availability", {
    p_vendor_id: vendor.id,
  });

  if (rpc.error) {
    throw new Error(rpc.error.message || "Vendor availability status could not be read.");
  }

  const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
  if (!row) throw new Error("Vendor availability status was not found.");

  const today = manilaDateKey();
  const dailyOpenDate = clean(vendor?.daily_open_date);

  return {
    ok: true,
    vendor_id: clean(vendor.id),
    display_name: clean(vendor.display_name || vendor.email || vendor.id),
    timezone: MANILA_TIME_ZONE,
    effective_accepting_orders: row.effective_accepting_orders === true,
    manual_accepting_orders: row.manual_accepting_orders === true,
    hours_enforced: row.hours_enforced === true,
    hours_configured: row.hours_configured === true,
    normal_open_time: hhmm(row.normal_open_time),
    normal_close_time: hhmm(row.normal_close_time),
    extended_from: row.extended_from || null,
    extended_until: row.extended_until || null,
    extension_active: row.extension_active === true,
    scheduled_open_at: row.scheduled_open_at || null,
    scheduled_close_at: row.scheduled_close_at || null,
    daily_opened: Boolean(today && dailyOpenDate === today && vendor?.accepting_orders === true),
    daily_open_date: dailyOpenDate || null,
    daily_opened_at: vendor?.daily_opened_at || null,
    reason: clean(row.reason || "unavailable"),
  };
}

export async function GET(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const vendorKey = clean(
    req.nextUrl.searchParams.get("vendor_id") || req.nextUrl.searchParams.get("vendorId"),
  );
  if (!vendorKey) {
    return json(400, {
      ok: false,
      error: "VENDOR_ID_REQUIRED",
      message: "vendor_id is required.",
    });
  }

  try {
    const vendor = await resolveVendor(admin, vendorKey);
    if (!vendor) {
      return json(404, {
        ok: false,
        error: "VENDOR_NOT_FOUND",
        message: "Vendor account was not found.",
      });
    }

    return json(200, await readStatus(admin, vendor));
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: "VENDOR_HOURS_READ_FAILED",
      message: clean(error?.message || error || "Vendor hours could not be read."),
    });
  }
}

export async function POST(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const body = await req.json().catch(() => ({} as any));
  const vendorKey = clean(body?.vendor_id || body?.vendorId);
  const action = clean(body?.action).toLowerCase();

  if (!vendorKey) {
    return json(400, {
      ok: false,
      error: "VENDOR_ID_REQUIRED",
      message: "vendor_id is required.",
    });
  }

  try {
    const vendor = await resolveVendor(admin, vendorKey);
    if (!vendor) {
      return json(404, {
        ok: false,
        error: "VENDOR_NOT_FOUND",
        message: "Vendor account was not found.",
      });
    }

    if (action === "save_hours") {
      const normalOpenTime = clean(body?.normal_open_time || body?.normalOpenTime);
      const normalCloseTime = clean(body?.normal_close_time || body?.normalCloseTime);

      if (!TIME_RE.test(normalOpenTime) || !TIME_RE.test(normalCloseTime)) {
        return json(400, {
          ok: false,
          error: "INVALID_VENDOR_HOURS",
          message: "Opening and closing times are required in HH:MM format.",
        });
      }

      if (normalOpenTime >= normalCloseTime) {
        return json(400, {
          ok: false,
          error: "INVALID_VENDOR_HOURS",
          message: "Closing time must be later than opening time on the same day. Overnight hours are not enabled.",
        });
      }

      const update = await admin
        .from("vendor_accounts")
        .update({
          normal_open_time: normalOpenTime,
          normal_close_time: normalCloseTime,
          hours_enforced: true,
          hours_updated_at: new Date().toISOString(),
          accepting_orders: false,
          daily_open_date: null,
          daily_opened_at: null,
          extended_from: null,
          extended_until: null,
        })
        .eq("id", vendor.id);

      if (update.error) {
        return json(500, {
          ok: false,
          error: "VENDOR_HOURS_SAVE_FAILED",
          message: update.error.message,
        });
      }
    } else if (action === "open_today") {
      if (
        vendor?.hours_enforced !== true ||
        !hhmm(vendor?.normal_open_time) ||
        !hhmm(vendor?.normal_close_time)
      ) {
        return json(409, {
          ok: false,
          error: "VENDOR_HOURS_REQUIRED",
          message: "Set your normal opening and closing time before opening for orders today.",
        });
      }

      const currentStatus = await readStatus(admin, vendor);
      const closeMs = currentStatus.scheduled_close_at
        ? new Date(currentStatus.scheduled_close_at).getTime()
        : NaN;
      if (Number.isFinite(closeMs) && Date.now() >= closeMs) {
        return json(409, {
          ok: false,
          error: "NORMAL_CLOSING_TIME_PASSED",
          message: "Today's normal closing time has already passed. The store cannot be reopened for a new normal shift today.",
        });
      }

      const nowIso = new Date().toISOString();
      const update = await admin
        .from("vendor_accounts")
        .update({
          accepting_orders: true,
          daily_open_date: manilaDateKey(),
          daily_opened_at: nowIso,
          extended_from: null,
          extended_until: null,
        })
        .eq("id", vendor.id);

      if (update.error) {
        return json(500, {
          ok: false,
          error: "VENDOR_DAILY_OPEN_FAILED",
          message: update.error.message,
        });
      }
    } else if (action === "close_today") {
      const update = await admin
        .from("vendor_accounts")
        .update({
          accepting_orders: false,
          extended_from: null,
          extended_until: null,
        })
        .eq("id", vendor.id);

      if (update.error) {
        return json(500, {
          ok: false,
          error: "VENDOR_DAILY_CLOSE_FAILED",
          message: update.error.message,
        });
      }
    } else if (action === "extend") {
      const minutes = Number(body?.minutes);
      if (minutes !== 30 && minutes !== 60) {
        return json(400, {
          ok: false,
          error: "INVALID_EXTENSION_MINUTES",
          message: "Extension must be 30 or 60 minutes.",
        });
      }

      const extend = await admin.rpc("vendor_extend_hours", {
        p_vendor_id: vendor.id,
        p_minutes: minutes,
      });

      if (extend.error) {
        return json(409, {
          ok: false,
          error: "VENDOR_EXTENSION_FAILED",
          message: extend.error.message || "Store hours could not be extended.",
        });
      }
    } else if (action === "end_extension") {
      const update = await admin
        .from("vendor_accounts")
        .update({ extended_from: null, extended_until: null })
        .eq("id", vendor.id);

      if (update.error) {
        return json(500, {
          ok: false,
          error: "VENDOR_EXTENSION_END_FAILED",
          message: update.error.message,
        });
      }
    } else {
      return json(400, {
        ok: false,
        error: "INVALID_ACTION",
        message: "Supported actions are save_hours, open_today, close_today, extend, and end_extension.",
      });
    }

    const refreshedVendor = await resolveVendor(admin, clean(vendor.id));
    if (!refreshedVendor) {
      return json(404, {
        ok: false,
        error: "VENDOR_NOT_FOUND",
        message: "Vendor account was not found after the update.",
      });
    }

    return json(200, await readStatus(admin, refreshedVendor));
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: "VENDOR_HOURS_UPDATE_FAILED",
      message: clean(error?.message || error || "Vendor hours could not be updated."),
    });
  }
}
