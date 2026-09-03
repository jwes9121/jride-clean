import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  signLegacyComplianceAcknowledgementToken,
} from "@/lib/vendorComplianceLegacyToken";
import { requireVendorSession } from "@/lib/vendorSession";

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

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
    clean(value)
  );
}

function timestamp(value: unknown): number {
  const result = new Date(clean(value)).getTime();
  return Number.isFinite(result) ? result : 0;
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

export async function GET(req: NextRequest) {
  const admin = adminClient();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Vendor compliance service is not configured.",
    });
  }

  const session = await requireVendorSession(req, admin);
  const legacyVendorId = clean(
    req.nextUrl.searchParams.get("vendor_id") ||
      req.nextUrl.searchParams.get("vendorId")
  );
  const legacySession = !session.ok && isUuid(legacyVendorId);

  if (!session.ok && !legacySession) {
    return json(session.status, {
      ok: false,
      error: session.error,
      message:
        session.error === "VENDOR_ACCESS_DISABLED"
          ? "Vendor access is not currently enabled."
          : "Vendor sign-in or a remembered vendor portal is required.",
    });
  }

  const vendorId = session.ok
    ? clean(session.vendor.vendorId)
    : legacyVendorId;
  const nowIso = new Date().toISOString();

  const expiry = await admin.rpc("expire_vendor_sanctions_v1");
  if (
    expiry.error &&
    !clean(expiry.error.message).includes("Could not find the function")
  ) {
    return json(500, {
      ok: false,
      error: "SANCTION_EXPIRY_REFRESH_FAILED",
      message: expiry.error.message,
    });
  }

  const [vendorRes, suspensionRes] = await Promise.all([
    admin
      .from("vendor_accounts")
      .select(
        "id,display_name,email,public_response_warning_until,public_response_warning_reason,suspended_until,suspension_reason"
      )
      .eq("id", vendorId)
      .maybeSingle(),
    admin
      .from("vendor_sanctions")
      .select(
        "id,vendor_id,sanction_type,status,starts_at,ends_at,reason,violation_code,vendor_message,suspension_scope,acknowledged_at"
      )
      .eq("vendor_id", vendorId)
      .eq("status", "active")
      .in("sanction_type", ["suspension_7_days", "manual"])
      .gt("ends_at", nowIso)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (vendorRes.error) {
    return json(500, {
      ok: false,
      error: "VENDOR_COMPLIANCE_READ_FAILED",
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
  if (suspensionRes.error) {
    return json(500, {
      ok: false,
      error: "SUSPENSION_READ_FAILED",
      message: suspensionRes.error.message,
    });
  }

  const vendor: any = vendorRes.data;
  const sanction: any = suspensionRes.data || null;
  const accountSuspended = timestamp(vendor.suspended_until) > Date.now();
  const suspended = Boolean(sanction) || accountSuspended;
  const warningActive =
    timestamp(vendor.public_response_warning_until) > Date.now();
  const acknowledgementRequired = Boolean(
    sanction?.id && !sanction?.acknowledged_at
  );
  const legacyAcknowledgementToken =
    legacySession && acknowledgementRequired
      ? signLegacyComplianceAcknowledgementToken(vendorId, sanction?.id)
      : null;

  const suspension = suspended
    ? {
        sanction_id: clean(sanction?.id) || null,
        violation_code:
          clean(sanction?.violation_code) || "COMPLIANCE_SUSPENSION",
        message:
          clean(sanction?.vendor_message || sanction?.reason) ||
          clean(vendor.suspension_reason) ||
          "JRide temporarily suspended new orders after an admin compliance review.",
        starts_at: sanction?.starts_at || null,
        ends_at: sanction?.ends_at || vendor.suspended_until || null,
        scope: clean(sanction?.suspension_scope) || "new_orders_only",
        acknowledged_at: sanction?.acknowledged_at || null,
        acknowledgement_required: acknowledgementRequired,
        acknowledgement_token: legacyAcknowledgementToken,
        reference: clean(sanction?.id)
          ? clean(sanction.id).slice(0, 8).toUpperCase()
          : "LEGACY",
      }
    : null;

  return json(200, {
    ok: true,
    vendor_id: vendorId,
    vendor_name: session.ok
      ? session.vendor.vendorName
      : clean(vendor.display_name || vendor.email || vendorId),
    legacy_session: legacySession,
    suspended,
    suspension,
    public_response_warning_active: warningActive,
    public_response_warning: warningActive
      ? {
          message:
            clean(vendor.public_response_warning_reason) ||
            "Repeated expired Takeout orders",
          ends_at: vendor.public_response_warning_until,
        }
      : null,
  });
}
