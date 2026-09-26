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

    const canViewLocation = access.staff.role === "admin";
    const approvedRes = canViewLocation
      ? await admin.from("passenger_verification_requests")
          .select(columns).eq("status", "approved")
          .order("reviewed_at", { ascending: false }).limit(50)
      : { data: [], error: null };
    const locationByPassenger = new Map<string, any>();
    let location_error: string | null = null;

    if (canViewLocation) {
      const ids = Array.from(new Set(
        [...(sub.data || []), ...(pad.data || []), ...(approvedRes.data || [])]
          .map((row: any) => String(row.passenger_id || ""))
          .filter(Boolean)
      ));
      if (ids.length) {
        const locationRes = await admin
          .from("passenger_verification_latest_location_v1")
          .select("passenger_id,request_submitted_at,server_received_at,device_status,device_source,device_latitude,device_longitude,device_accuracy_m,device_captured_at,declared_town,network_city,network_region,network_country")
          .in("passenger_id", ids);
        if (locationRes.error) {
          location_error = "Verification submission location could not be loaded. Please retry.";
        } else {
          for (const location of locationRes.data || []) {
            locationByPassenger.set(String(location.passenger_id), location);
          }
        }
      }
    }

    // Queue access never grants image access. Both review screens use the
    // same on-demand, admin-only, audited evidence endpoint as Analytics V3.
    function safeRows(rows: any[] | null, includeLocation: boolean) {
      return (rows || []).map((row) => ({
        passenger_id: row.passenger_id, full_name: row.full_name, town: row.town,
        status: row.status, submitted_at: row.submitted_at, reviewed_at: row.reviewed_at,
        reviewed_by: row.reviewed_by, admin_notes: row.admin_notes,
        has_id_front: !!row.id_front_path, has_id_back: !!row.id_back_path,
        has_selfie: !!row.selfie_with_id_path, can_view_evidence: access.ok && access.staff.role === "admin",
        can_view_verification_location: canViewLocation,
        verification_location: includeLocation && canViewLocation
          ? (locationByPassenger.get(String(row.passenger_id)) || null)
          : null,
      }));
    }
    const submitted = safeRows(sub.data, true);
    const pending_admin = safeRows(pad.data, true);
    const declined = safeRows(rejected.data, false);
    const approved = safeRows(approvedRes.data, true);
    return json(200, {
      ok: true,
      counts: {
        submitted: submitted.length,
        pending_admin: pending_admin.length,
        declined: declined.length,
        approved_recent: approved.length,
      },
      rows: { submitted, pending_admin, declined, approved },
      verification_location_error: location_error,
      auth_debug: { requester_email: access.staff.email, is_admin: access.staff.role === "admin", is_dispatcher: access.staff.role === "dispatcher" },
    });
  } catch {
    return json(503, { ok: false, error: "Verification queue is unavailable. Please retry." });
  }
}
