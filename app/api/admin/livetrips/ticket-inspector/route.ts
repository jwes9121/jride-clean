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

function asArray<T>(v: T[] | T | null | undefined): T[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function ts(v: unknown): number {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : 0;
}

function diagnostic(severity: string, code: string, message: string, evidence: string[]) {
  return { severity, code, message, evidence };
}

function timelineItem(at: string | null, source: string, actor: string | null, action: string, evidence: any, from_status?: string | null, to_status?: string | null) {
  return {
    at,
    source,
    actor,
    action,
    from_status: from_status ?? null,
    to_status: to_status ?? null,
    evidence,
  };
}

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
    return NextResponse.json({ ok: false, error: "MISSING_QUERY", message: "Ticket query is required." }, { status: 400 });
  }

  try {
    const supabase = getSupabase();

    let bookingRows: any[] = [];

    if (isUuid(q)) {
      const byId = await supabase
        .from("bookings")
        .select("*")
        .eq("id", q)
        .limit(5);

      if (byId.error) {
        return NextResponse.json({ ok: false, error: "BOOKING_LOOKUP_FAILED", message: byId.error.message }, { status: 500 });
      }

      bookingRows = asArray<any>(byId.data);
    }

    if (!bookingRows.length) {
      const byCode = await supabase
        .from("bookings")
        .select("*")
        .ilike("booking_code", "%" + q + "%")
        .order("updated_at", { ascending: false })
        .limit(10);

      if (byCode.error) {
        return NextResponse.json({ ok: false, error: "BOOKING_LOOKUP_FAILED", message: byCode.error.message }, { status: 500 });
      }

      bookingRows = asArray<any>(byCode.data);
    }

    if (!bookingRows.length) {
      return NextResponse.json({ ok: false, error: "TICKET_NOT_FOUND", message: "No booking matched this ticket query." }, { status: 404 });
    }

    const booking = bookingRows[0];
    const bookingId = text(booking?.id);
    const bookingCode = text(booking?.booking_code);

    const statusAuditRes = await supabase
      .from("booking_status_audit")
      .select("id, booking_id, old_status, new_status, source, actor_type, actor_id, created_at")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });

    if (statusAuditRes.error) {
      return NextResponse.json({ ok: false, error: "BOOKING_STATUS_AUDIT_FAILED", message: statusAuditRes.error.message }, { status: 500 });
    }

    const adminAuditLogRes = await supabase
      .from("admin_audit_log")
      .select("id, created_at, actor_id, actor_email, action, booking_id, booking_code, from_status, to_status, meta")
      .or("booking_id.eq." + bookingId + ",booking_code.eq." + bookingCode)
      .order("created_at", { ascending: true });

    if (adminAuditLogRes.error) {
      return NextResponse.json({ ok: false, error: "ADMIN_AUDIT_LOG_FAILED", message: adminAuditLogRes.error.message }, { status: 500 });
    }

    const adminAuditLogsRes = await supabase
      .from("admin_audit_logs")
      .select("id, created_at, actor, action, entity_type, entity_id, payload")
      .in("entity_id", [bookingId, bookingCode])
      .order("created_at", { ascending: true });

    if (adminAuditLogsRes.error) {
      return NextResponse.json({ ok: false, error: "ADMIN_AUDIT_LOGS_FAILED", message: adminAuditLogsRes.error.message }, { status: 500 });
    }

    const statusAuditRows = asArray<any>(statusAuditRes.data);
    const adminAuditLogRows = asArray<any>(adminAuditLogRes.data);
    const adminAuditLogsRows = asArray<any>(adminAuditLogsRes.data);

    const timeline = [
      timelineItem(booking?.created_at ?? null, "bookings", "system", "booking_created", booking, null, booking?.status ?? null),
      ...statusAuditRows.map((row) =>
        timelineItem(
          row?.created_at ?? null,
          "booking_status_audit",
          text(row?.actor_type || row?.source || "system"),
          "status_changed",
          row,
          row?.old_status ?? null,
          row?.new_status ?? null
        )
      ),
      ...adminAuditLogRows.map((row) =>
        timelineItem(
          row?.created_at ?? null,
          "admin_audit_log",
          text(row?.actor_email || row?.actor_id || "admin"),
          text(row?.action || "admin_action"),
          row,
          row?.from_status ?? null,
          row?.to_status ?? null
        )
      ),
      ...adminAuditLogsRows.map((row) =>
        timelineItem(
          row?.created_at ?? null,
          "admin_audit_logs",
          text(row?.actor || "admin"),
          text(row?.action || "admin_action"),
          row,
          null,
          null
        )
      ),
    ].sort((a, b) => ts(a.at) - ts(b.at));

    const diagnostics = [];
    const status = text(booking?.status).toLowerCase();
    const serviceType = text(booking?.service_type).toLowerCase();
    const hasAnyAdminAudit = adminAuditLogRows.length > 0 || adminAuditLogsRows.length > 0;

    if (!statusAuditRows.length) {
      diagnostics.push(diagnostic("warn", "NO_BOOKING_STATUS_AUDIT", "No booking_status_audit rows found for this booking.", ["booking_status_audit count = 0"]));
    }

    if (!hasAnyAdminAudit) {
      diagnostics.push(diagnostic("info", "NO_ADMIN_AUDIT", "No admin audit rows found in confirmed admin audit tables.", ["admin_audit_log count = 0", "admin_audit_logs count = 0"]));
    }

    if (status === "cancelled" && !hasAnyAdminAudit) {
      diagnostics.push(diagnostic("warn", "CANCELLED_WITHOUT_ADMIN_AUDIT", "Booking is cancelled, but no confirmed admin audit row identifies an admin actor.", ["bookings.status = cancelled", "no admin audit rows"]));
    }

    if (statusAuditRows.length && statusAuditRows.every((row) => text(row?.actor_type || row?.source).toLowerCase() === "system")) {
      diagnostics.push(diagnostic("info", "SYSTEM_ONLY_STATUS_AUDIT", "All booking_status_audit rows are system sourced.", ["actor_type/source values are system only"]));
    }

    if (booking?.assigned_driver_id || booking?.driver_id) {
      diagnostics.push(diagnostic("info", "DRIVER_ATTACHED", "Booking has a driver reference.", ["driver_id or assigned_driver_id is present"]));
    } else if (!["completed", "cancelled"].includes(status)) {
      diagnostics.push(diagnostic("warn", "NO_DRIVER_ATTACHED", "Active booking has no driver reference.", ["driver_id is empty", "assigned_driver_id is empty"]));
    }

    const acceptExpiry = booking?.takeout_driver_accept_expires_at || booking?.driver_accept_expires_at || null;
    if (acceptExpiry && Date.parse(String(acceptExpiry)) < Date.now() && ["assigned", "driver_assigned", "searching"].includes(status)) {
      diagnostics.push(diagnostic("warn", "DRIVER_ACCEPT_EXPIRED", "Driver accept timer is expired while booking is still not completed or cancelled.", ["accept expiry is in the past", "status = " + status]));
    }

    const feeExpiry = booking?.takeout_fee_expires_at || booking?.takeout_fee_proposal_expires_at || null;
    if (serviceType === "takeout" && feeExpiry && Date.parse(String(feeExpiry)) < Date.now() && !["completed", "cancelled"].includes(status)) {
      diagnostics.push(diagnostic("warn", "TAKEOUT_FEE_EXPIRED", "Takeout fee timer is expired while booking is still open.", ["takeout fee expiry is in the past", "status = " + status]));
    }

    if (status === "completed" && booking?.company_cut == null) {
      diagnostics.push(diagnostic("warn", "MISSING_COMPANY_CUT", "Completed booking has no company_cut value in bookings.", ["bookings.company_cut is null"]));
    }

    return NextResponse.json({
      ok: true,
      query: q,
      booking,
      matches: bookingRows.map((row) => ({
        id: row?.id ?? null,
        booking_code: row?.booking_code ?? null,
        status: row?.status ?? null,
        service_type: row?.service_type ?? null,
        passenger_name: row?.passenger_name ?? null,
        town: row?.town ?? null,
        updated_at: row?.updated_at ?? null,
      })),
      timeline,
      diagnostics,
      raw: {
        booking,
        booking_status_audit: statusAuditRows,
        admin_audit_log: adminAuditLogRows,
        admin_audit_logs: adminAuditLogsRows,
        note: "V1 uses only confirmed schema tables. dispatch_actions and wallet transaction tables are intentionally excluded until their schema is proven.",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TICKET_INSPECTOR_FAILED",
        message: String(err?.message ?? err),
      },
      { status: 500 }
    );
  }
}