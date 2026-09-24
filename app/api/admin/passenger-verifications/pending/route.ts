import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

export async function GET() {
  try {
    const access = await requireStaff();
    if (!access.ok) return json(access.status, { ok: false, error: access.error });
    const admin = supabaseAdmin({ noStore: true });
    const columns = "passenger_id,full_name,town,status,submitted_at,reviewed_at,reviewed_by,admin_notes,id_front_path,id_back_path,selfie_with_id_path";
    const [sub, pad, rejected] = await Promise.all([
      admin.from("passenger_verification_requests").select(columns).eq("status", "submitted").order("submitted_at", { ascending: false }),
      admin.from("passenger_verification_requests").select(columns).eq("status", "pending_admin").order("submitted_at", { ascending: false }),
      admin.from("passenger_verification_requests").select(columns).eq("status", "rejected").order("reviewed_at", { ascending: false }).limit(200),
    ]);
    if (sub.error || pad.error || rejected.error) {
      return json(503, { ok: false, error: "Verification queue is unavailable. Please retry." });
    }
    // Queue access never grants image access. Both review screens use the
    // same on-demand, admin-only, audited evidence endpoint as Analytics V3.
    function safeRows(rows: any[] | null) {
      return (rows || []).map((row) => ({
        passenger_id: row.passenger_id, full_name: row.full_name, town: row.town,
        status: row.status, submitted_at: row.submitted_at, reviewed_at: row.reviewed_at,
        reviewed_by: row.reviewed_by, admin_notes: row.admin_notes,
        has_id_front: !!row.id_front_path, has_id_back: !!row.id_back_path,
        has_selfie: !!row.selfie_with_id_path, can_view_evidence: access.ok && access.staff.role === "admin",
      }));
    }
    const submitted = safeRows(sub.data);
    const pending_admin = safeRows(pad.data);
    const declined = safeRows(rejected.data);
    return json(200, {
      ok: true,
      counts: { submitted: submitted.length, pending_admin: pending_admin.length, declined: declined.length },
      rows: { submitted, pending_admin, declined },
      auth_debug: { requester_email: access.staff.email, is_admin: access.staff.role === "admin", is_dispatcher: access.staff.role === "dispatcher" },
    });
  } catch {
    return json(503, { ok: false, error: "Verification queue is unavailable. Please retry." });
  }
}
