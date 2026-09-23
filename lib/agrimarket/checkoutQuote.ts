export const QUOTE_COLUMNS = {
  "address": "id,address_text,label,lat,lng,is_active",
  "products": "id,producer_id,name,product_group,species,meat_cut,cargo_class,selling_unit,unit_weight_kg,unit_price,availability_mode,harvest_start_at,harvest_end_at,harvest_order_cutoff_at,default_prep_minutes,vehicle_requirement,handling_eligible,is_active",
  "producer": "id,pickup_lat,pickup_lng,status,accepting_orders,store_open,marketplace_fee_percent,pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions",
  "pricing": "id,pricing_version,currency,base_delivery_fee,route_fee_per_km,delivery_company_cut,rounding_mode,is_active,cash_first_threshold,heavy_load_exact_tier1_max_kg,heavy_load_exact_tier2_max_kg,heavy_load_exact_tier3_max_kg,heavy_load_exact_tier4_max_kg,kolong_kolong_max_kg,heavy_load_tier1_fee,heavy_load_tier2_fee,heavy_load_tier3_fee,heavy_load_tier4_fee,special_handling_standard_fee,special_handling_bulky_fee,special_handling_live_single_fee,special_handling_live_difficult_fee"
} as const;
function project(row: any, columns: string) {
  return Object.fromEntries(columns.split(",").map(key => [key, row?.[key] ?? null]));
}
export function quoteBasis(userId: string, context: any, pricing: any) {
  return { customer_user_id: userId, preferred_vehicle_type: context.preferredVehicleType,
    items: context.items.map((item: any) => ({product_id: item.product_id, quantity: item.quantity})).sort((a: any,b: any) => a.product_id.localeCompare(b.product_id)),
    address: project(context.address, QUOTE_COLUMNS.address), producer: project(context.producer, QUOTE_COLUMNS.producer),
    products: context.products.map((row: any) => project(row, QUOTE_COLUMNS.products)).sort((a: any,b: any) => String(a.id).localeCompare(String(b.id))),
    pricing: project(pricing, QUOTE_COLUMNS.pricing) };
}
export function quoteFailure(code: unknown): {status: number; error: string; message: string} {
  const raw = String(code || "");
  if (raw.includes("QUOTE_ALREADY_USED") || raw.includes("QUOTE_REPLAY_CONFLICT")) return {status:409,error:"AGRIMARKET_QUOTE_ALREADY_USED",message:"This quote belongs to a previous checkout attempt. Check your orders before starting another order."};
  if (raw.includes("QUOTE_EXPIRED")) return {status:409,error:"AGRIMARKET_QUOTE_EXPIRED",message:"This price quote expired. Review a fresh quote before placing the order. Your cart has not been changed."};
  if (raw.includes("QUOTE") || raw.includes("ITEM_UNAVAILABLE") || raw.includes("PRODUCER_UNAVAILABLE") || raw.includes("HARVEST_ORDER_CUTOFF")) return {status:409,error:"AGRIMARKET_QUOTE_CHANGED",message:"The price, schedule, stock, store or delivery details changed. Review a fresh quote before placing the order."};
  return {status:503,error:"AGRIMARKET_CHECKOUT_UNCONFIRMED",message:"Checkout could not be confirmed. Retry the same checkout attempt or check your orders before ordering again."};
}
