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
  }>;
  productSubtotal: number;
  requiredVehicleType: "either" | "motorcycle" | "tricycle";
  preferredVehicleType: "motorcycle" | "tricycle";
  handlingEligible: boolean;
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
      "id,producer_id,name,selling_unit,unit_price,remaining_quantity,availability_mode,default_prep_minutes,vehicle_requirement,handling_eligible,is_active"
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
  const itemSnapshots: AgrimarketOrderContext["itemSnapshots"] = [];
  let productSubtotal = 0;
  let handlingEligible = false;
  let requiresTricycle = false;
  let allRequireMotorcycle = true;

  for (const requested of items) {
    const product: any = productById.get(requested.product_id);
    if (!product || product.is_active !== true) {
      throw new AgrimarketRequestError("AGRIMARKET_ITEM_UNAVAILABLE", 409, "One or more selected Agrimarket items are unavailable.");
    }
    if (String(product.availability_mode || "") === "scheduled_harvest") {
      throw new AgrimarketRequestError(
        "AGRIMARKET_SCHEDULED_HARVEST_POLICY_REQUIRED",
        409,
        "Scheduled-harvest ordering is not enabled yet."
      );
    }

    const available = Number(product.remaining_quantity);
    if (!Number.isFinite(available) || available < requested.quantity) {
      throw new AgrimarketRequestError(
        "AGRIMARKET_INSUFFICIENT_STOCK",
        409,
        `${String(product.name || "Product")} does not have enough available quantity.`
      );
    }

    producerIds.add(String(product.producer_id || ""));
    const vehicle = String(product.vehicle_requirement || "either").toLowerCase();
    if (vehicle === "tricycle") requiresTricycle = true;
    if (vehicle !== "motorcycle") allRequireMotorcycle = false;

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
    });
  }

  if (producerIds.size !== 1) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_SINGLE_PRODUCER_ORDER_REQUIRED",
      409,
      "Each Agrimarket order must contain products from one producer only."
    );
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
      "This producer is not accepting Agrimarket orders right now."
    );
  }

  const producerLat = Number((producerRes.data as any).pickup_lat);
  const producerLng = Number((producerRes.data as any).pickup_lng);
  if (!Number.isFinite(producerLat) || !Number.isFinite(producerLng)) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_PRODUCER_PIN_REQUIRED",
      409,
      "The producer pickup pin is not configured correctly."
    );
  }

  const requiredVehicleType: "either" | "motorcycle" | "tricycle" = requiresTricycle
    ? "tricycle"
    : allRequireMotorcycle
      ? "motorcycle"
      : "either";

  if (requiredVehicleType !== "either" && preferredVehicleType !== requiredVehicleType) {
    throw new AgrimarketRequestError(
      "AGRIMARKET_VEHICLE_REQUIREMENT_MISMATCH",
      409,
      `This order requires a ${requiredVehicleType}.`
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
  };
}
