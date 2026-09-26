import { createServiceSupabase, jsonNoStore, requireAgrimarketStaff } from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type ProductRow = {
  id: string;
  producer_id: string;
  name: string;
  description: string | null;
  product_group: string;
  species: string | null;
  breed: string | null;
  meat_cut: string | null;
  processing_form: string | null;
  condition: string;
  cargo_class: string;
  selling_unit: string;
  unit_weight_kg: number | string | null;
  unit_price: number | string;
  listed_quantity: number | string;
  reserved_quantity: number | string;
  sold_quantity: number | string;
  remaining_quantity: number | string;
  availability_mode: string;
  harvest_start_at: string | null;
  harvest_end_at: string | null;
  harvest_order_cutoff_at: string | null;
  default_prep_minutes: number | string;
  vehicle_requirement: string;
  handling_eligible: boolean;
  photo_urls: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  const staff = await requireAgrimarketStaff(true);
  if (!staff.ok) return staff.response;

  const admin = createServiceSupabase();
  const [producerRes, productRes, credentialRes] = await Promise.all([
    admin
      .from("agrimarket_producers")
      .select(
        "id,vendor_name,contact_name,contact_phone,town,barangay,pickup_label,pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions,status,accepting_orders,store_open,catalog_approved_at,created_at,updated_at"
      )
      .order("updated_at", { ascending: false })
      .limit(500),
    admin
      .from("agrimarket_products")
      .select(
        "id,producer_id,name,description,product_group,species,breed,meat_cut,processing_form,condition,cargo_class,selling_unit,unit_weight_kg,unit_price,listed_quantity,reserved_quantity,sold_quantity,remaining_quantity,availability_mode,harvest_start_at,harvest_end_at,harvest_order_cutoff_at,default_prep_minutes,vehicle_requirement,handling_eligible,photo_urls,is_active,created_at,updated_at"
      )
      .order("updated_at", { ascending: false })
      .limit(2000),
    admin
      .from("agrimarket_producer_credentials")
      .select("producer_id,status,last_used_at")
      .limit(500),
  ]);

  if (producerRes.error || productRes.error || credentialRes.error) {
    return jsonNoStore(503, {
      ok: false,
      error: "AGRIMARKET_CATALOG_REVIEW_READ_FAILED",
      message:
        producerRes.error?.message ||
        productRes.error?.message ||
        credentialRes.error?.message ||
        "Unable to load the AgriMarket catalog review.",
    });
  }

  const productsByProducer = new Map<string, ProductRow[]>();
  for (const row of (productRes.data || []) as ProductRow[]) {
    const current = productsByProducer.get(row.producer_id) || [];
    current.push(row);
    productsByProducer.set(row.producer_id, current);
  }

  const credentialByProducer = new Map(
    (credentialRes.data || []).map((row: any) => [String(row.producer_id), row])
  );

  const stores = (producerRes.data || [])
    .map((producer: any) => {
      const products = productsByProducer.get(String(producer.id)) || [];
      const credential: any = credentialByProducer.get(String(producer.id)) || null;
      const activeAvailableProductCount = products.filter(
        (product) => product.is_active === true && Number(product.remaining_quantity || 0) > 0
      ).length;

      return {
        ...producer,
        credential_status: credential?.status || null,
        credential_last_used_at: credential?.last_used_at || null,
        active_available_product_count: activeAvailableProductCount,
        product_count: products.length,
        products,
      };
    })
    .filter((store: any) => store.product_count > 0);

  return jsonNoStore(200, {
    ok: true,
    staff_role: staff.role,
    stores,
  });
}
