import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assignErrandStage0 } from "@/lib/errand/assignStage0";

export const dynamic = "force-dynamic";

function noStore() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

type ExpiredOfferRow = {
  id: string;
  booking_code: string | null;
  assigned_driver_id: string | null;
  driver_id: string | null;
  driver_accept_expires_at: string | null;
};

type SweepError = {
  bookingId: string;
  bookingCode: string | null;
  error: string;
};

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401, headers: noStore() }
    );
  }

  const admin = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("bookings")
    .select(
      "id,booking_code,assigned_driver_id,driver_id,driver_accept_expires_at"
    )
    .eq("service_type", "errand")
    .eq("status", "assigned")
    .not("driver_accept_expires_at", "is", null)
    .lte("driver_accept_expires_at", nowIso)
    .limit(50);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_OFFER_EXPIRY_SCAN_FAILED",
        message: error.message,
      },
      { status: 500, headers: noStore() }
    );
  }

  const rows = (data ?? []) as ExpiredOfferRow[];
  const errors: SweepError[] = [];
  let expiredCount = 0;
  let reassignedCount = 0;

  for (const row of rows) {
    const bookingId = text(row.id);
    const bookingCode = row.booking_code ? text(row.booking_code) : null;
    const expiredDriverId = text(row.assigned_driver_id || row.driver_id);

    if (!bookingId || !expiredDriverId) continue;

    try {
      const expireRes = await admin.rpc("errand_driver_expire_offer_v1", {
        p_booking_id: bookingId,
        p_driver_id: expiredDriverId,
      });

      if (expireRes.error) {
        errors.push({
          bookingId,
          bookingCode,
          error: expireRes.error.message,
        });
        continue;
      }

      const expireResult = (expireRes.data as any) || {};
      if (expireResult.ok === false) {
        const reason = text(expireResult.error) || "ERRAND_OFFER_EXPIRY_BLOCKED";
        if (
          reason === "BOOKING_NOT_ASSIGNED" ||
          reason === "DRIVER_NOT_ASSIGNED" ||
          reason === "OFFER_NOT_EXPIRED"
        ) {
          continue;
        }
        errors.push({ bookingId, bookingCode, error: reason });
        continue;
      }

      expiredCount += 1;

      const reassignment = await assignErrandStage0({ bookingId });
      if ((reassignment as any)?.assigned) {
        reassignedCount += 1;
      }

      console.log(
        "[JRIDE_ERRAND_OFFER_EXPIRED]",
        JSON.stringify({
          bookingCode,
          bookingId,
          expiredDriverId,
          expiredAt: row.driver_accept_expires_at,
          reassignment,
        })
      );
    } catch (err: any) {
      errors.push({
        bookingId,
        bookingCode,
        error: text(err?.message || err) || "ERRAND_OFFER_EXPIRY_UNEXPECTED_ERROR",
      });
    }
  }

  return NextResponse.json(
    {
      ok: errors.length === 0,
      generated_at: nowIso,
      scanned: rows.length,
      expired: expiredCount,
      reassigned: reassignedCount,
      errors,
    },
    { status: errors.length ? 207 : 200, headers: noStore() }
  );
}
