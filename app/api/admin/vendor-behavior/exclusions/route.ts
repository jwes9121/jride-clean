import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createVendorMetricsAdmin } from "@/lib/vendorPerformanceServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function requireAdmin() {
  const session = await auth().catch(() => null as any);
  const role = text((session as any)?.user?.role).toLowerCase();
  if (role !== "admin") return null;
  return {
    email: text((session as any)?.user?.email),
    id: text((session as any)?.user?.id),
  };
}

export async function GET() {
  const actor = await requireAdmin();
  if (!actor) {
    return NextResponse.json({ ok: false, error: "ADMIN_REQUIRED" }, { status: 403 });
  }

  try {
    const admin = createVendorMetricsAdmin();
    const [subjects, bookings] = await Promise.all([
      admin
        .from("analytics_test_subjects")
        .select("id,subject_type,subject_id,reason,active,marked_by,created_at,updated_at")
        .order("created_at", { ascending: false }),
      admin
        .from("analytics_booking_exclusions")
        .select("booking_id,reason,active,marked_by,created_at,updated_at")
        .order("created_at", { ascending: false }),
    ]);

    if (subjects.error) throw new Error(subjects.error.message);
    if (bookings.error) throw new Error(bookings.error.message);

    return NextResponse.json({
      ok: true,
      test_subjects: Array.isArray(subjects.data) ? subjects.data : [],
      booking_exclusions: Array.isArray(bookings.data) ? bookings.data : [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "EXCLUSION_LIST_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireAdmin();
  if (!actor) {
    return NextResponse.json({ ok: false, error: "ADMIN_REQUIRED" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const action = text(body?.action).toLowerCase();
  const reason = text(body?.reason);
  const markedBy = actor.email || actor.id || "admin";

  try {
    const admin = createVendorMetricsAdmin();

    if (action === "mark_passenger" || action === "mark_vendor") {
      const subjectType = action === "mark_passenger" ? "passenger" : "vendor";
      const subjectId = text(body?.subject_id || body?.passenger_id || body?.vendor_id);
      if (!isUuid(subjectId)) {
        return NextResponse.json({ ok: false, error: "INVALID_SUBJECT_ID" }, { status: 400 });
      }
      if (!reason) {
        return NextResponse.json({ ok: false, error: "REASON_REQUIRED" }, { status: 400 });
      }

      const result = await admin
        .from("analytics_test_subjects")
        .upsert(
          {
            subject_type: subjectType,
            subject_id: subjectId,
            reason,
            active: true,
            marked_by: markedBy,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "subject_type,subject_id" }
        )
        .select("id,subject_type,subject_id,reason,active,marked_by,created_at,updated_at")
        .single();

      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ ok: true, action, record: result.data });
    }

    if (action === "unmark_passenger" || action === "unmark_vendor") {
      const subjectType = action === "unmark_passenger" ? "passenger" : "vendor";
      const subjectId = text(body?.subject_id || body?.passenger_id || body?.vendor_id);
      if (!isUuid(subjectId)) {
        return NextResponse.json({ ok: false, error: "INVALID_SUBJECT_ID" }, { status: 400 });
      }

      const result = await admin
        .from("analytics_test_subjects")
        .update({ active: false, marked_by: markedBy, updated_at: new Date().toISOString() })
        .eq("subject_type", subjectType)
        .eq("subject_id", subjectId);

      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ ok: true, action, subject_type: subjectType, subject_id: subjectId });
    }

    if (action === "exclude_booking") {
      const bookingId = text(body?.booking_id);
      if (!isUuid(bookingId)) {
        return NextResponse.json({ ok: false, error: "INVALID_BOOKING_ID" }, { status: 400 });
      }
      if (!reason) {
        return NextResponse.json({ ok: false, error: "REASON_REQUIRED" }, { status: 400 });
      }

      const result = await admin
        .from("analytics_booking_exclusions")
        .upsert(
          {
            booking_id: bookingId,
            reason,
            active: true,
            marked_by: markedBy,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "booking_id" }
        )
        .select("booking_id,reason,active,marked_by,created_at,updated_at")
        .single();

      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ ok: true, action, record: result.data });
    }

    if (action === "include_booking") {
      const bookingId = text(body?.booking_id);
      if (!isUuid(bookingId)) {
        return NextResponse.json({ ok: false, error: "INVALID_BOOKING_ID" }, { status: 400 });
      }

      const result = await admin
        .from("analytics_booking_exclusions")
        .update({ active: false, marked_by: markedBy, updated_at: new Date().toISOString() })
        .eq("booking_id", bookingId);

      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ ok: true, action, booking_id: bookingId });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_ACTION",
        message: "Supported actions: mark_passenger, unmark_passenger, mark_vendor, unmark_vendor, exclude_booking, include_booking.",
      },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "EXCLUSION_UPDATE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
