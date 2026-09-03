import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_MANUAL_DURATIONS = new Set([1, 3, 7, 14, 30]);
const ALLOWED_VIOLATION_CODES = new Set([
  "REPEATED_ORDER_TIMEOUTS",
  "REPEATED_UNEXCUSED_OFFLINE_DAYS",
  "CUSTOMER_COMPLAINT",
  "FALSE_OR_MISLEADING_MENU",
  "PRICE_OR_ORDER_MANIPULATION",
  "ABUSIVE_CONDUCT",
  "FOOD_OR_PRODUCT_SAFETY",
  "TERMS_OF_SERVICE_VIOLATION",
  "OTHER",
]);

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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    clean(value)
  );
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

type StaffIdentity = {
  role: "admin" | "dispatcher";
  userId: string;
  email: string;
  name: string;
};

type StaffAccess =
  | { ok: true; staff: StaffIdentity }
  | { ok: false; response: NextResponse };

async function requireStaff(allowDispatcher: boolean): Promise<StaffAccess> {
  const session = await auth().catch(() => null as any);
  const user = (session?.user ?? null) as any;

  if (!user) {
    return {
      ok: false,
      response: json(401, {
        ok: false,
        error: "AUTH_REQUIRED",
        message: "Staff sign-in is required.",
      }),
    };
  }

  const role = clean(user?.role).toLowerCase();
  const allowed =
    role === "admin" || (allowDispatcher && role === "dispatcher");

  if (!allowed) {
    return {
      ok: false,
      response: json(403, {
        ok: false,
        error: allowDispatcher ? "STAFF_REQUIRED" : "ADMIN_REQUIRED",
        message: allowDispatcher
          ? "Admin or dispatcher access is required."
          : "Only a JRide admin can perform this action.",
      }),
    };
  }

  return {
    ok: true,
    staff: {
      role: role as "admin" | "dispatcher",
      userId: clean(user?.id),
      email: clean(user?.email).toLowerCase(),
      name: clean(user?.name),
    },
  };
}

function requestId(value: unknown): string {
  const supplied = clean(value);
  return isUuid(supplied) ? supplied : randomUUID();
}

function rpcError(error: any, fallbackError: string) {
  const raw = clean(error?.message || error?.details || error?.hint);
  const known: Array<[string, number, string]> = [
    ["VENDOR_ALREADY_SUSPENDED", 409, "This vendor already has an active suspension."],
    ["VENDOR_WARNING_ALREADY_ACTIVE", 409, "This vendor already has an active response warning."],
    ["VENDOR_NOT_FOUND", 404, "The selected vendor was not found."],
    ["COMPLIANCE_REVIEW_NOT_FOUND", 404, "The compliance review was not found."],
    ["COMPLIANCE_REVIEW_NOT_PENDING", 409, "This compliance review has already been processed."],
    ["COMPLIANCE_REVIEW_NOT_SUSPENSION", 409, "This review is not eligible for suspension."],
    ["COMPLIANCE_REVIEW_NOT_WARNING", 409, "This review is not eligible for a response warning."],
    ["SANCTION_NOT_FOUND", 404, "The sanction was not found."],
    ["SANCTION_NOT_ACTIVE", 409, "The sanction is no longer active."],
    ["INVALID_SUSPENSION_END", 400, "The suspension end date is invalid."],
    ["INVALID_VENDOR_MESSAGE", 400, "Enter a clear vendor-facing violation message."],
    ["INVALID_VIOLATION_CODE", 400, "Select a valid violation category."],
    ["INVALID_REVOCATION_REASON", 400, "Enter a clear revocation reason."],
  ];

  for (const [code, status, message] of known) {
    if (raw.includes(code)) {
      return json(status, { ok: false, error: code, message });
    }
  }

  return json(500, {
    ok: false,
    error: fallbackError,
    message: raw || "The compliance action failed.",
  });
}

function actorLabel(staff: StaffIdentity): string {
  return staff.email || staff.userId || staff.name || "JRide admin";
}

export async function GET() {
  const access = await requireStaff(true);
  if (!access.ok) return access.response;

  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const expiry = await admin.rpc("expire_vendor_sanctions_v1");
  if (
    expiry.error &&
    !clean(expiry.error.message).includes("Could not find the function")
  ) {
    return rpcError(expiry.error, "SANCTION_EXPIRY_REFRESH_FAILED");
  }

  const [reviewsRes, sanctionsRes, exemptionsRes, vendorsRes] =
    await Promise.all([
      admin
        .from("vendor_compliance_reviews")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      admin
        .from("vendor_sanctions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      admin
        .from("vendor_compliance_exemptions")
        .select("*")
        .eq("active", true)
        .order("exemption_date", { ascending: true })
        .limit(500),
      admin
        .from("vendor_accounts")
        .select(
          "id,display_name,email,town,vendor_compliance_started_on,consecutive_vendor_timeouts,consecutive_offline_days,public_response_warning_until,public_response_warning_reason,suspended_until,suspension_reason,accepting_orders,hours_enforced,normal_open_time,normal_close_time"
        )
        .order("town", { ascending: true })
        .order("display_name", { ascending: true }),
    ]);

  for (const result of [reviewsRes, sanctionsRes, exemptionsRes, vendorsRes]) {
    if (result.error) {
      return json(500, {
        ok: false,
        error: "COMPLIANCE_READ_FAILED",
        message: result.error.message,
      });
    }
  }

  const vendors = Array.isArray(vendorsRes.data) ? vendorsRes.data : [];
  const vendorById = new Map(
    vendors.map((row: any) => [clean(row?.id), row])
  );
  const withVendor = (row: any) => {
    const vendor = vendorById.get(clean(row?.vendor_id)) as any;
    return {
      ...row,
      vendor_name: clean(
        vendor?.display_name || vendor?.email || row?.vendor_id
      ),
      town: clean(vendor?.town) || null,
    };
  };

  const canManage = access.staff.role === "admin";
  const sanctions = (sanctionsRes.data || []).map(withVendor).map((row: any) => {
    if (canManage) return row;
    const {
      internal_note: _internalNote,
      evidence: _evidence,
      actor_user_id: _actorUserId,
      actor_email: _actorEmail,
      ...safeRow
    } = row;
    return safeRow;
  });

  return json(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    viewer_role: access.staff.role,
    viewer_email: access.staff.email || null,
    can_manage: canManage,
    policy: {
      offline_days_review: 3,
      timeout_warning_review: 2,
      timeout_suspension_review: 3,
      warning_days: 7,
      suspension_days: 7,
      manual_suspension_durations_days: [1, 3, 7, 14, 30],
      automatic_enforcement: false,
    },
    reviews: (reviewsRes.data || []).map(withVendor),
    sanctions,
    exemptions: (exemptionsRes.data || []).map(withVendor),
    vendors,
  });
}

export async function POST(req: NextRequest) {
  const access = await requireStaff(false);
  if (!access.ok) return access.response;

  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const body = await req.json().catch(() => ({} as any));
  const action = clean(body?.action).toLowerCase();
  const note = clean(body?.note || body?.review_note || body?.internal_note);
  const now = new Date();
  const nowIso = now.toISOString();
  const actor = actorLabel(access.staff);
  const actorUserId = access.staff.userId || actor;
  const actorEmail = access.staff.email;

  if (action === "add_exemption") {
    const exemptionDate = clean(body?.exemption_date);
    const vendorId = clean(body?.vendor_id) || null;
    const reason = clean(body?.reason);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exemptionDate) || !reason) {
      return json(400, { ok: false, error: "DATE_AND_REASON_REQUIRED" });
    }
    if (vendorId && !isUuid(vendorId)) {
      return json(400, {
        ok: false,
        error: "INVALID_VENDOR_ID",
        message: "Select a valid vendor or leave it blank for all vendors.",
      });
    }
    const insert = await admin
      .from("vendor_compliance_exemptions")
      .insert({
        exemption_date: exemptionDate,
        vendor_id: vendorId,
        reason,
        active: true,
        created_by: actor,
      })
      .select("*")
      .single();
    if (insert.error) {
      return json(500, {
        ok: false,
        error: "EXEMPTION_SAVE_FAILED",
        message: insert.error.message,
      });
    }
    return json(200, { ok: true, exemption: insert.data });
  }

  if (action === "remove_exemption") {
    const id = clean(body?.id);
    if (!isUuid(id)) {
      return json(400, { ok: false, error: "INVALID_EXEMPTION_ID" });
    }
    const update = await admin
      .from("vendor_compliance_exemptions")
      .update({ active: false, updated_at: nowIso })
      .eq("id", id);
    if (update.error) {
      return json(500, {
        ok: false,
        error: "EXEMPTION_REMOVE_FAILED",
        message: update.error.message,
      });
    }
    return json(200, { ok: true });
  }

  if (action === "dismiss_review") {
    const id = clean(body?.review_id);
    if (!isUuid(id)) {
      return json(400, { ok: false, error: "INVALID_REVIEW_ID" });
    }
    const update = await admin
      .from("vendor_compliance_reviews")
      .update({
        status: "dismissed",
        reviewed_at: nowIso,
        reviewed_by: actor,
        review_note: note || null,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (update.error) {
      return json(500, {
        ok: false,
        error: "REVIEW_DISMISS_FAILED",
        message: update.error.message,
      });
    }
    if (!update.data) {
      return json(409, {
        ok: false,
        error: "REVIEW_NOT_PENDING",
        message: "This review has already been processed.",
      });
    }
    return json(200, { ok: true });
  }

  if (action === "approve_warning") {
    const reviewId = clean(body?.review_id);
    if (!isUuid(reviewId)) {
      return json(400, { ok: false, error: "INVALID_REVIEW_ID" });
    }

    const result = await admin.rpc("admin_approve_vendor_warning_v1", {
      p_review_id: reviewId,
      p_internal_note: note || null,
      p_actor_user_id: actorUserId,
      p_actor_email: actorEmail || null,
      p_request_id: requestId(body?.request_id),
    });
    if (result.error) return rpcError(result.error, "WARNING_APPLY_FAILED");
    return json(200, { ok: true, action, result: result.data });
  }

  if (action === "suspend_7_days") {
    const reviewId = clean(body?.review_id);
    if (!isUuid(reviewId)) {
      return json(400, { ok: false, error: "INVALID_REVIEW_ID" });
    }

    const reviewRes = await admin
      .from("vendor_compliance_reviews")
      .select("id,vendor_id,review_type,status,reason")
      .eq("id", reviewId)
      .eq("status", "pending")
      .maybeSingle();

    if (reviewRes.error) {
      return json(500, {
        ok: false,
        error: "REVIEW_READ_FAILED",
        message: reviewRes.error.message,
      });
    }
    if (!reviewRes.data) {
      return json(404, {
        ok: false,
        error: "PENDING_REVIEW_NOT_FOUND",
        message: "The pending compliance review was not found.",
      });
    }

    const review: any = reviewRes.data;
    const reviewType = clean(review.review_type);
    if (!["suspension_timeout", "suspension_offline"].includes(reviewType)) {
      return json(409, {
        ok: false,
        error: "REVIEW_NOT_SUSPENSION_TYPE",
        message: "This review is not eligible for suspension.",
      });
    }

    const violationCode =
      reviewType === "suspension_timeout"
        ? "REPEATED_ORDER_TIMEOUTS"
        : "REPEATED_UNEXCUSED_OFFLINE_DAYS";
    const vendorMessage =
      reviewType === "suspension_timeout"
        ? "Your store did not respond to three consecutive Takeout orders within the required response time."
        : "Your store was unavailable for three consecutive scheduled operating days without an approved closure.";
    const endsAt = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = await admin.rpc("admin_suspend_vendor_v1", {
      p_vendor_id: clean(review.vendor_id),
      p_violation_code: violationCode,
      p_vendor_message: vendorMessage,
      p_internal_note: note || clean(review.reason) || null,
      p_ends_at: endsAt,
      p_actor_user_id: actorUserId,
      p_actor_email: actorEmail || null,
      p_request_id: requestId(body?.request_id),
      p_source_review_id: reviewId,
    });
    if (result.error) return rpcError(result.error, "SUSPENSION_APPLY_FAILED");
    return json(200, { ok: true, action, result: result.data });
  }

  if (action === "suspend_manual") {
    const vendorId = clean(body?.vendor_id);
    const violationCode = clean(body?.violation_code).toUpperCase();
    const vendorMessage = clean(body?.vendor_message);
    const internalNote = clean(body?.internal_note);
    const durationDays = Number(body?.duration_days);

    if (!isUuid(vendorId)) {
      return json(400, {
        ok: false,
        error: "INVALID_VENDOR_ID",
        message: "Select a valid vendor.",
      });
    }
    if (!ALLOWED_VIOLATION_CODES.has(violationCode)) {
      return json(400, {
        ok: false,
        error: "INVALID_VIOLATION_CODE",
        message: "Select a valid violation category.",
      });
    }
    if (vendorMessage.length < 10 || vendorMessage.length > 1000) {
      return json(400, {
        ok: false,
        error: "INVALID_VENDOR_MESSAGE",
        message: "Enter a clear vendor-facing message between 10 and 1000 characters.",
      });
    }
    if (internalNote.length < 5 || internalNote.length > 2000) {
      return json(400, {
        ok: false,
        error: "INVALID_INTERNAL_NOTE",
        message: "Enter an internal admin note between 5 and 2000 characters.",
      });
    }
    if (!ALLOWED_MANUAL_DURATIONS.has(durationDays)) {
      return json(400, {
        ok: false,
        error: "INVALID_DURATION",
        message: "Select an approved suspension duration.",
      });
    }

    const endsAt = new Date(
      now.getTime() + durationDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const result = await admin.rpc("admin_suspend_vendor_v1", {
      p_vendor_id: vendorId,
      p_violation_code: violationCode,
      p_vendor_message: vendorMessage,
      p_internal_note: internalNote,
      p_ends_at: endsAt,
      p_actor_user_id: actorUserId,
      p_actor_email: actorEmail || null,
      p_request_id: requestId(body?.request_id),
      p_source_review_id: null,
    });
    if (result.error) return rpcError(result.error, "SUSPENSION_APPLY_FAILED");
    return json(200, { ok: true, action, result: result.data });
  }

  if (action === "revoke_sanction") {
    const sanctionId = clean(body?.sanction_id);
    const revokeReason = clean(body?.note || body?.revoke_reason);
    if (!isUuid(sanctionId)) {
      return json(400, { ok: false, error: "INVALID_SANCTION_ID" });
    }
    if (revokeReason.length < 5 || revokeReason.length > 1000) {
      return json(400, {
        ok: false,
        error: "INVALID_REVOCATION_REASON",
        message: "Enter a clear revocation reason.",
      });
    }

    const result = await admin.rpc("admin_revoke_vendor_sanction_v1", {
      p_sanction_id: sanctionId,
      p_reason: revokeReason,
      p_actor_user_id: actorUserId,
      p_actor_email: actorEmail || null,
    });
    if (result.error) return rpcError(result.error, "SANCTION_REVOKE_FAILED");
    return json(200, { ok: true, action, result: result.data });
  }

  return json(400, { ok: false, error: "INVALID_ACTION" });
}
