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
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET() {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const [reviewsRes, sanctionsRes, exemptionsRes, vendorsRes] = await Promise.all([
    admin.from("vendor_compliance_reviews").select("*").order("created_at", { ascending: false }).limit(500),
    admin.from("vendor_sanctions").select("*").order("created_at", { ascending: false }).limit(500),
    admin.from("vendor_compliance_exemptions").select("*").eq("active", true).order("exemption_date", { ascending: true }).limit(500),
    admin.from("vendor_accounts").select("id,display_name,email,town,vendor_compliance_started_on,consecutive_vendor_timeouts,consecutive_offline_days,public_response_warning_until,public_response_warning_reason,suspended_until,suspension_reason,hours_enforced,normal_open_time,normal_close_time"),
  ]);

  for (const result of [reviewsRes, sanctionsRes, exemptionsRes, vendorsRes]) {
    if (result.error) {
      return json(500, { ok: false, error: "COMPLIANCE_READ_FAILED", message: result.error.message });
    }
  }

  const vendors = Array.isArray(vendorsRes.data) ? vendorsRes.data : [];
  const vendorById = new Map(vendors.map((row: any) => [clean(row?.id), row]));
  const withVendor = (row: any) => {
    const vendor = vendorById.get(clean(row?.vendor_id)) as any;
    return {
      ...row,
      vendor_name: clean(vendor?.display_name || vendor?.email || row?.vendor_id),
      town: clean(vendor?.town) || null,
    };
  };

  return json(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    policy: {
      offline_days_review: 3,
      timeout_warning_review: 2,
      timeout_suspension_review: 3,
      warning_days: 7,
      suspension_days: 7,
      automatic_enforcement: false,
    },
    reviews: (reviewsRes.data || []).map(withVendor),
    sanctions: (sanctionsRes.data || []).map(withVendor),
    exemptions: (exemptionsRes.data || []).map(withVendor),
    vendors,
  });
}

export async function POST(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const body = await req.json().catch(() => ({} as any));
  const action = clean(body?.action).toLowerCase();
  const actor = clean(body?.actor || body?.reviewed_by || "JRide admin");
  const note = clean(body?.note || body?.review_note);
  const now = new Date();
  const nowIso = now.toISOString();

  if (action === "add_exemption") {
    const exemptionDate = clean(body?.exemption_date);
    const vendorId = clean(body?.vendor_id) || null;
    const reason = clean(body?.reason);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exemptionDate) || !reason) {
      return json(400, { ok: false, error: "DATE_AND_REASON_REQUIRED" });
    }
    const insert = await admin.from("vendor_compliance_exemptions").insert({
      exemption_date: exemptionDate,
      vendor_id: vendorId,
      reason,
      active: true,
      created_by: actor,
    }).select("*").single();
    if (insert.error) return json(500, { ok: false, error: "EXEMPTION_SAVE_FAILED", message: insert.error.message });
    return json(200, { ok: true, exemption: insert.data });
  }

  if (action === "remove_exemption") {
    const id = clean(body?.id);
    const update = await admin.from("vendor_compliance_exemptions").update({ active: false, updated_at: nowIso }).eq("id", id);
    if (update.error) return json(500, { ok: false, error: "EXEMPTION_REMOVE_FAILED", message: update.error.message });
    return json(200, { ok: true });
  }

  if (action === "dismiss_review") {
    const id = clean(body?.review_id);
    const update = await admin.from("vendor_compliance_reviews").update({
      status: "dismissed",
      reviewed_at: nowIso,
      reviewed_by: actor,
      review_note: note || null,
    }).eq("id", id).eq("status", "pending");
    if (update.error) return json(500, { ok: false, error: "REVIEW_DISMISS_FAILED", message: update.error.message });
    return json(200, { ok: true });
  }

  if (action === "approve_warning" || action === "suspend_7_days") {
    const reviewId = clean(body?.review_id);
    const reviewRes = await admin.from("vendor_compliance_reviews").select("*").eq("id", reviewId).eq("status", "pending").single();
    if (reviewRes.error || !reviewRes.data) {
      return json(404, { ok: false, error: "PENDING_REVIEW_NOT_FOUND" });
    }

    const review: any = reviewRes.data;
    const vendorId = clean(review.vendor_id);
    const endsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    if (action === "approve_warning") {
      if (clean(review.review_type) !== "response_warning") {
        return json(409, { ok: false, error: "REVIEW_NOT_WARNING_TYPE" });
      }
      const vendorUpdate = await admin.from("vendor_accounts").update({
        public_response_warning_until: endsAt,
        public_response_warning_reason: review.reason,
      }).eq("id", vendorId);
      if (vendorUpdate.error) return json(500, { ok: false, error: "WARNING_APPLY_FAILED", message: vendorUpdate.error.message });

      const sanction = await admin.from("vendor_sanctions").insert({
        vendor_id: vendorId,
        sanction_type: "public_response_warning",
        status: "active",
        starts_at: nowIso,
        ends_at: endsAt,
        reason: review.reason,
        evidence: review.evidence || {},
        created_by: actor,
      }).select("*").single();
      if (sanction.error) return json(500, { ok: false, error: "WARNING_AUDIT_FAILED", message: sanction.error.message });
    } else {
      if (!["suspension_timeout", "suspension_offline"].includes(clean(review.review_type))) {
        return json(409, { ok: false, error: "REVIEW_NOT_SUSPENSION_TYPE" });
      }
      const vendorUpdate = await admin.from("vendor_accounts").update({
        suspended_until: endsAt,
        suspension_reason: review.reason,
        accepting_orders: false,
        consecutive_vendor_timeouts: 0,
        consecutive_offline_days: 0,
      }).eq("id", vendorId);
      if (vendorUpdate.error) return json(500, { ok: false, error: "SUSPENSION_APPLY_FAILED", message: vendorUpdate.error.message });

      const sanction = await admin.from("vendor_sanctions").insert({
        vendor_id: vendorId,
        sanction_type: "suspension_7_days",
        status: "active",
        starts_at: nowIso,
        ends_at: endsAt,
        reason: review.reason,
        evidence: review.evidence || {},
        created_by: actor,
      }).select("*").single();
      if (sanction.error) return json(500, { ok: false, error: "SUSPENSION_AUDIT_FAILED", message: sanction.error.message });
    }

    const reviewUpdate = await admin.from("vendor_compliance_reviews").update({
      status: "approved",
      reviewed_at: nowIso,
      reviewed_by: actor,
      review_note: note || null,
    }).eq("id", reviewId);
    if (reviewUpdate.error) return json(500, { ok: false, error: "REVIEW_UPDATE_FAILED", message: reviewUpdate.error.message });

    return json(200, { ok: true, action, vendor_id: vendorId, ends_at: endsAt });
  }

  if (action === "revoke_sanction") {
    const sanctionId = clean(body?.sanction_id);
    const sanctionRes = await admin.from("vendor_sanctions").select("*").eq("id", sanctionId).eq("status", "active").single();
    if (sanctionRes.error || !sanctionRes.data) return json(404, { ok: false, error: "ACTIVE_SANCTION_NOT_FOUND" });
    const sanction: any = sanctionRes.data;
    const vendorId = clean(sanction.vendor_id);

    if (sanction.sanction_type === "public_response_warning") {
      await admin.from("vendor_accounts").update({ public_response_warning_until: null, public_response_warning_reason: null }).eq("id", vendorId);
    } else if (sanction.sanction_type === "suspension_7_days") {
      await admin.from("vendor_accounts").update({ suspended_until: null, suspension_reason: null }).eq("id", vendorId);
    }

    const update = await admin.from("vendor_sanctions").update({
      status: "revoked",
      revoked_at: nowIso,
      revoked_by: actor,
      revoke_reason: note || "Admin revoked sanction",
    }).eq("id", sanctionId);
    if (update.error) return json(500, { ok: false, error: "SANCTION_REVOKE_FAILED", message: update.error.message });
    return json(200, { ok: true });
  }

  return json(400, { ok: false, error: "INVALID_ACTION" });
}
