import { createServiceSupabase, jsonNoStore, requireAgrimarketStaff } from "../../_lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const staff = await requireAgrimarketStaff(true);
  if (!staff.ok) return staff.response;
  const admin = createServiceSupabase();
  const devices = await admin.from("agrimarket_driver_devices").select("id,driver_id,device_id,status,client_version,created_at,reviewed_at,reviewed_by,review_note").order("created_at", { ascending: false }).limit(200);
  if (devices.error) return jsonNoStore(503, { ok: false, message: "Driver phone requests are unavailable." });
  const ids = [...new Set((devices.data || []).map(row => row.driver_id))];
  const profiles = ids.length ? await admin.from("driver_profiles").select("driver_id,full_name,callsign,municipality,vehicle_type").in("driver_id", ids) : { data: [], error: null };
  if (profiles.error) return jsonNoStore(503, { ok: false, message: "Driver profiles are unavailable." });
  return jsonNoStore(200, { ok: true, devices: (devices.data || []).map(row => ({ ...row, driver: profiles.data?.find(p => p.driver_id === row.driver_id) || null })) });
}

export async function POST(req: Request) {
  const staff = await requireAgrimarketStaff(true);
  if (!staff.ok) return staff.response;
  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || !["approve", "revoke"].includes(body.decision) || typeof body.note !== "string" || body.note.trim().length < 5 || body.note.length > 500 || (body.decision === "approve" && body.device_confirmed !== true)) {
    return jsonNoStore(400, { ok: false, message: "Verify the driver and phone request code, then add a review note." });
  }
  const result = await createServiceSupabase().rpc("agrimarket_review_driver_device_v1", { p_id: body.id, p_decision: body.decision, p_actor: staff.actor, p_actor_role: staff.role, p_note: body.note.trim() });
  if (result.error) return jsonNoStore(409, { ok: false, message: "The request could not be updated. Refresh its status; expired or revoked requests need a new request from the phone." });
  return jsonNoStore(200, { ok: true, device: result.data });
}
