export type RequestedAgrimarketItem = {
  product_id: string;
  quantity: number;
};

export type AgrimarketOrderContext = {
  address: any;
  producer: any;
  items: RequestedAgrimarketItem[];
  itemSnapshots: Array<{
    product_id: string;
    name: string;
    selling_unit: string;
    unit_price: number;
    quantity: number;
    line_total: number;
    handling_eligible: boolean;
    availability_mode: "always_available" | "scheduled_harvest";
    harvest_start_at: string | null;
    harvest_end_at: string | null;
    harvest_order_cutoff_at: string | null;
  }>;
  productSubtotal: number;
  requiredVehicleType: "either" | "tricycle";
  preferredVehicleType: "motorcycle" | "tricycle";
  handlingEligible: boolean;
  fulfillmentMode: "always_available" | "scheduled_harvest";
  harvestExpectedStartAt: string | null;
  harvestExpectedEndAt: string | null;
  harvestOrderCutoffAt: string | null;
};

export class AgrimarketRequestError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizedIso(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function normalizeAgrimarketItems(body: any): RequestedAgrimarketItem[] {
  const raw = Array.isArray(body?.items) ? body.items : [];
  if (!raw.length) {
    throw new AgrimarketRequestError("AGRIMARKET_ITEMS_REQUIRED", 400, "At least one Agrimarket item is required.");
  }
  if (raw.length > 50) {
    throw new AgrimarketRequestError("AGRIMARKET_TOO_MANY_ITEMS", 400, "An Agrimarket order may contain at most 50 product lines.");
  }

  const items: RequestedAgrimarketItem[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    const productId = String(row?.product_id || row?.productId || row?.id || "").trim();
    const quantity = Number(row?.quantity ?? row?.qty);

    if (!isUuid(productId)) {
      throw new AgrimarketRequestError("AGRIMARKET_INVALID_PRODUCT_ID", 400, "Every item must contain a valid product_id.");
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new AgrimarketRequestError("AGRIMARKET_INVALID_QUANTITY", 400, "Every Agrimarket quantity must be greater than zero.");
    }
    if (seen.has(productId)) {
      throw new AgrimarketRequestError("AGRIMARKET_DUPLICATE_PRODUCT", 400, "Duplicate product lines are not allowed.");
    }

    seen.add(productId);
    items.push({ product_id: productId, quantity });
  }

  return items;
}

export function normalizeAgrimarketAddressId(body: any): string {
  const value = String(body?.address_id || body?.addressId || body?.delivery_address_id || "").trim();
  if (!isUuid(value)) {
    throw new AgrimarketRequestError("AGRIMARKET_INVALID_ADDRESS_ID", 400, "A valid delivery address_id is required.");
  }
  return value;
}

export function normalizeAgrimarketPreferredVehicle(body: any): "motorcycle" | "tricycle" {
  const value = String(body?.preferred_vehicle_type || body?.preferredVehicleType || "").trim().toLowerCase();
  if (value !== "motorcycle" && value !== "tricycle") {
    throw new AgrimarketRequestError(
      "AGRIMARKET_INVALID_PREFERRED_VEHICLE",
      400,
      "preferred_vehicle_type must be motorcycle or tricycle."
    );
  }
  return value;
}

export async function loadAgrimarketOrderContext(
  admin: any,
  customerUserId: string,
  addressId: string,
  items: RequestedAgrimarketItem[],
  preferredVehicleType: "motorcycle" | "tricycle"
): Promise<AgrimarketOrderContext> {
  const addressRes = await admin
    .from("passenger_addresses")
    .select("id,address_text,label,lat,lng,is_active")
    .eq("id", addressId)
    .eq("created_by_user_id", customerUserId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (addressRes.error) {
    throw new AgrimarketRequestError("AGRIMARKET_ADDRESS_LOOKUP_FAILED", 500, addressRes.error.message);
  }
  if (!addressRes.data) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_DELIVERY_ADDRESS_NOT_OWNED",
      404,
      "The selected delivery address was not found for this passenger."
    );
  }

  const addressLat = Number((addressRes.data as any).lat);
  const addressLng = Number((addressRes.data as any).lng);
  if (!Number.isFinite(addressLat) || !Number.isFinite(addressLng)) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_DELIVERY_PIN_REQUIRED",
      409,
      "The selected delivery address needs a valid map pin."
    );
  }

  const productIds = items.map((item) => item.product_id);
  const productsRes = await admin
    .from("agrimarket_products")
    .select(
      "id,producer_id,name,selling_unit,unit_price,remaining_quantity,availability_mode,harvest_start_at,harvest_end_at,harvest_order_cutoff_at,default_prep_minutes,vehicle_requirement,handling_eligible,is_active"
    )
    .in("id", productIds);

  if (productsRes.error) {
    throw new AgrimarketRequestError("AGRIMARKET_PRODUCT_LOOKUP_FAILED", 500, productsRes.error.message);
  }

  const products = Array.isArray(productsRes.data) ? productsRes.data : [];
  if (products.length !== items.length) {
    throw new AgrimarketRequestError("AGRIMARKET_PRODUCT_NOT_FOUND", 404, "One or more Agrimarket products no longer exist.");
  }

  const productById = new Map<string, any>();
  for (const product of products) productById.set(String((product as any).id), product);

  const producerIds = new Set<string>();
  const modes = new Set<string>();
  const harvestStarts = new Set<string>();
  const harvestEnds = new Set<string>();
  const itemSnapshots: AgrimarketOrderContext["itemSnapshots"] = [];
  let productSubtotal = 0;
  let handlingEligible = false;
  let requiresTricycle = false;
  let earliestCutoffMs = Number.POSITIVE_INFINITY;
  let earliestCutoffIso: string | null = null;

  for (const requested of items) {
    const product: any = productById.get(requested.product_id);
    if (!product || product.is_active !== true) {
      throw new AgrimarketRequestError("AGRIMARKET_ITEM_UNAVAILABLE", 409, "One or more selected Agrimarket items are unavailable.");
    }

    const mode = String(product.availability_mode || "always_available").toLowerCase();
    if (mode !== "always_available" && mode !== "scheduled_harvest") {
      throw new AgrimarketRequestError("AGRIMARKET_AVAILABILITY_MODE_INVALID", 409, "A selected product has an invalid availability mode.");
    }

    const harvestStartAt = normalizedIso(product.harvest_start_at);
    const harvestEndAt = normalizedIso(product.harvest_end_at);
    const harvestCutoffAt = normalizedIso(product.harvest_order_cutoff_at);

    if (mode === "scheduled_harvest") {
      if (!harvestStartAt || !harvestCutoffAt) {
        throw new AgrimarketRequestError(
          "AGRIMARKET_HARVEST_WINDOW_INCOMPLETE",
          409,
          `${String(product.name || "Product")} does not have a complete harvest reservation window.`
        );
      }
      const cutoffMs = Date.parse(harvestCutoffAt);
      if (!Number.isFinite(cutoffMs) || cutoffMs <= Date.now()) {
        throw new AgrimarketRequestError(
          "AGRIMARKET_HARVEST_ORDER_CUTOFF_PASSED",
          409,
          `The reservation cutoff has passed for ${String(product.name || "this harvest")}.`
        );
      }
      harvestStarts.add(harvestStartAt);
      harvestEnds.add(harvestEndAt || harvestStartAt);
      if (cutoffMs < earliestCutoffMs) {
        earliestCutoffMs = cutoffMs;
        earliestCutoffIso = harvestCutoffAt;
      }
    }

    const available = Number(product.remaining_quantity);
    if (!Number.isFinite(available) || available < requested.quantity) {
      throw new AgrimarketRequestError(
        "AGRIMARKET_INSUFFICIENT_STOCK",
        409,
        `${String(product.name || "Product")} does not have enough reservable quantity.`
      );
    }

    producerIds.add(String(product.producer_id || ""));
    modes.add(mode);
    if (String(product.vehicle_requirement || "either").toLowerCase() === "tricycle") {
      requiresTricycle = true;
    }

    const unitPrice = money(product.unit_price);
    const lineTotal = money(unitPrice * requested.quantity);
    productSubtotal = money(productSubtotal + lineTotal);
    handlingEligible = handlingEligible || product.handling_eligible === true;

    itemSnapshots.push({
      product_id: requested.product_id,
      name: String(product.name || ""),
      selling_unit: String(product.selling_unit || ""),
      unit_price: unitPrice,
      quantity: requested.quantity,
      line_total: lineTotal,
      handling_eligible: product.handling_eligible === true,
      availability_mode: mode as "always_available" | "scheduled_harvest",
      harvest_start_at: harvestStartAt,
      harvest_end_at: harvestEndAt,
      harvest_order_cutoff_at: harvestCutoffAt,
    });
  }

  if (producerIds.size !== 1) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_SINGLE_PRODUCER_ORDER_REQUIRED",
      409,
      "Each Agrimarket cart must contain products from one farmer only. Finish or clear the current farmer cart before adding another farmer."
    );
  }

  if (modes.size !== 1) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_MIXED_AVAILABILITY_CART_NOT_ALLOWED",
      409,
      "Always Available and Scheduled Harvest products cannot be placed in the same order."
    );
  }

  const fulfillmentMode = Array.from(modes)[0] as "always_available" | "scheduled_harvest";
  let harvestExpectedStartAt: string | null = null;
  let harvestExpectedEndAt: string | null = null;

  if (fulfillmentMode === "scheduled_harvest") {
    if (harvestStarts.size !== 1 || harvestEnds.size !== 1) {
      throw new AgrimarketRequestError(
        "AGRIMARKET_SCHEDULED_ITEMS_REQUIRE_SAME_HARVEST_WINDOW",
        409,
        "Scheduled Harvest products may share one order only when they use the same harvest window."
      );
    }
    harvestExpectedStartAt = Array.from(harvestStarts)[0] || null;
    const end = Array.from(harvestEnds)[0] || harvestExpectedStartAt;
    harvestExpectedEndAt = end === harvestExpectedStartAt ? null : end;
  }

  const producerId = Array.from(producerIds)[0];
  const producerRes = await admin
    .from("agrimarket_producers")
    .select("id,pickup_lat,pickup_lng,status,accepting_orders,marketplace_fee_percent")
    .eq("id", producerId)
    .limit(1)
    .maybeSingle();

  if (producerRes.error) {
    throw new AgrimarketRequestError("AGRIMARKET_PRODUCER_LOOKUP_FAILED", 500, producerRes.error.message);
  }
  if (
    !producerRes.data ||
    String((producerRes.data as any).status || "").toLowerCase() !== "active" ||
    (producerRes.data as any).accepting_orders !== true
  ) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_PRODUCER_UNAVAILABLE",
      409,
      "This farmer is not accepting Agrimarket orders right now."
    );
  }

  const producerLat = Number((producerRes.data as any).pickup_lat);
  const producerLng = Number((producerRes.data as any).pickup_lng);
  if (!Number.isFinite(producerLat) || !Number.isFinite(producerLng)) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_PRODUCER_PIN_REQUIRED",
      409,
      "The farmer pickup pin is not configured correctly."
    );
  }

  const requiredVehicleType: "either" | "tricycle" = requiresTricycle ? "tricycle" : "either";

  if (requiredVehicleType === "tricycle" && preferredVehicleType !== "tricycle") {
    throw new AgrimarketRequestError(
      "AGRIMARKET_VEHICLE_REQUIREMENT_MISMATCH",
      409,
      "This cart requires a tricycle."
    );
  }

  return {
    address: addressRes.data,
    producer: producerRes.data,
    items,
    itemSnapshots,
    productSubtotal,
    requiredVehicleType,
    preferredVehicleType,
    handlingEligible,
    fulfillmentMode,
    harvestExpectedStartAt,
    harvestExpectedEndAt,
    harvestOrderCutoffAt: fulfillmentMode === "scheduled_harvest" ? earliestCutoffIso : null,
  };
}
