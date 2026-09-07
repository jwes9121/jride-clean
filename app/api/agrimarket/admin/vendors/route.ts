import { createServiceSupabase, jsonNoStore, requireAgrimarketStaff } from "../../_lib/server";

export const dynamic = "force-dynamic";
export async function GET() {
  const staff = await requireAgrimarketStaff(true);
  if (!staff.ok) return staff.response;
  const result = await createServiceSupabase().from("agrimarket_producers").select("id,vendor_name,contact_name,town,status,accepting_orders").order("created_at", { ascending: false }).limit(500);
  if (result.error) return jsonNoStore(503, { ok: false, message: "Vendor names are temporarily unavailable." });
  return jsonNoStore(200, { ok: true, vendors: result.data || [] });
}
