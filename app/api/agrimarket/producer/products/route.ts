import { NextRequest } from "next/server";
import {
  agrimarketDisabledResponse,
  agrimarketEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketProducer,
} from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const PRODUCT_GROUPS = new Set(["produce", "grain", "aquatic", "poultry", "livestock", "meat", "eggs", "other_agri"]);
const CONDITIONS = new Set(["normal", "fresh", "chilled", "frozen", "live_at_pickup"]);
const CARGO_CLASSES = new Set([
  "standard_produce",
  "fragile_produce",
  "bulk_sack",
  "crate",
  "live_fish",
  "live_poultry",
  "live_livestock",
  "fresh_meat",
  "chilled_meat",
  "frozen_meat",
  "other_agri",
]);
const AVAILABILITY_MODES = new Set(["always_available", "scheduled_harvest"]);
const VEHICLES = new Set(["either", "motorcycle", "tricycle"]);
const PROCESSING_FORMS = new Set(["whole", "chopped", "sliced", "ground", "other"]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uuid(value: unknown): string | null {
  const raw = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) return null;
  return raw;
}

function isoOrNull(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function productPayload(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    product_group: row.product_group,
    species: row.species,
    breed: row.breed,
    meat_cut: row.meat_cut,
    processing_form: row.processing_form,
    condition: row.condition,
    cargo_class: row.cargo_class,
    selling_unit: row.selling_unit,
    unit_weight_kg: row.unit_weight_kg == null ? null : Number(row.unit_weight_kg),
    unit_price: Number(row.unit_price || 0),
    listed_quantity: Number(row.listed_quantity || 0),
    reserved_quantity: Number(row.reserved_quantity || 0),
    sold_quantity: Number(row.sold_quantity || 0),
    remaining_quantity: Number(row.remaining_quantity || 0),
    availability_mode: row.availability_mode,
    harvest_start_at: row.harvest_start_at,
    harvest_end_at: row.harvest_end_at,
    harvest_order_cutoff_at: row.harvest_order_cutoff_at,
    default_prep_minutes: Number(row.default_prep_minutes || 0),
    vehicle_requirement: row.vehicle_requirement,
    handling_eligible: Boolean(row.handling_eligible),
    photo_urls: Array.isArray(row.photo_urls) ? row.photo_urls : [],
    is_active: Boolean(row.is_active),
    updated_at: row.updated_at,
  };
}

async function readOwnProducts(admin: any, producerId: string) {
  return admin
    .from("agrimarket_products")
    .select(
      "id,name,description,product_group,species,breed,meat_cut,processing_form,condition,cargo_class,selling_unit,unit_weight_kg,unit_price,listed_quantity,reserved_quantity,sold_quantity,remaining_quantity,availability_mode,harvest_start_at,harvest_end_at,harvest_order_cutoff_at,default_prep_minutes,vehicle_requirement,handling_eligible,photo_urls,is_active,updated_at"
    )
    .eq("producer_id", producerId)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });
}

export async function GET(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const producerAuth = await requireAgrimarketProducer(req);
    if (producerAuth.ok === false) return producerAuth.response;
    const admin = createServiceSupabase();
    const productsRes = await readOwnProducts(admin, producerAuth.producer.id);

    if (productsRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_PRODUCTS_FAILED",
        message: productsRes.error.message,
      });
    }

    return jsonNoStore(200, {
      ok: true,
      farmer_fee_policy: "free_launch_v1",
      farmer_wallet_enabled: false,
      products: (Array.isArray(productsRes.data) ? productsRes.data : []).map(productPayload),
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_PRODUCER_PRODUCTS_FAILED",
      message: String(error?.message || error),
    });
  }
}

export async function POST(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const producerAuth = await requireAgrimarketProducer(req);
    if (producerAuth.ok === false) return producerAuth.response;
    const admin = createServiceSupabase();
    const body = await req.json().catch(() => ({}));
    const action = lower(body?.action || "create");

    if (action === "set_active") {
      const productId = uuid(body?.product_id || body?.productId);
      if (!productId || typeof body?.is_active !== "boolean") {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PRODUCT_ACTIVE_INPUT_INVALID" });
      }

      const updateRes = await admin
        .from("agrimarket_products")
        .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
        .eq("id", productId)
        .eq("producer_id", producerAuth.producer.id)
        .select("id")
        .maybeSingle();

      if (updateRes.error) {
        return jsonNoStore(409, { ok: false, error: "AGRIMARKET_PRODUCT_UPDATE_FAILED", message: updateRes.error.message });
      }
      if (!updateRes.data) return jsonNoStore(404, { ok: false, error: "AGRIMARKET_PRODUCT_NOT_FOUND" });
    } else if (action === "set_available_quantity") {
      const productId = uuid(body?.product_id || body?.productId);
      const available = finiteNumber(body?.available_quantity ?? body?.availableQuantity);
      if (!productId || available == null || available < 0) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_AVAILABLE_QUANTITY_INVALID" });
      }

      const currentRes = await admin
        .from("agrimarket_products")
        .select("id,reserved_quantity,sold_quantity")
        .eq("id", productId)
        .eq("producer_id", producerAuth.producer.id)
        .limit(1)
        .maybeSingle();

      if (currentRes.error) {
        return jsonNoStore(500, { ok: false, error: "AGRIMARKET_PRODUCT_LOOKUP_FAILED", message: currentRes.error.message });
      }
      if (!currentRes.data) return jsonNoStore(404, { ok: false, error: "AGRIMARKET_PRODUCT_NOT_FOUND" });

      const listedQuantity =
        Number(currentRes.data.reserved_quantity || 0) + Number(currentRes.data.sold_quantity || 0) + available;
      const updateRes = await admin
        .from("agrimarket_products")
        .update({ listed_quantity: listedQuantity, updated_at: new Date().toISOString() })
        .eq("id", productId)
        .eq("producer_id", producerAuth.producer.id);

      if (updateRes.error) {
        return jsonNoStore(409, { ok: false, error: "AGRIMARKET_PRODUCT_QUANTITY_UPDATE_FAILED", message: updateRes.error.message });
      }
    } else if (action === "set_unit_weight") {
      const productId = uuid(body?.product_id || body?.productId);
      const unitWeightKg = finiteNumber(body?.unit_weight_kg ?? body?.unitWeightKg);
      if (!productId || (unitWeightKg != null && unitWeightKg <= 0)) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_UNIT_WEIGHT_INVALID" });
      }

      const updateRes = await admin
        .from("agrimarket_products")
        .update({ unit_weight_kg: unitWeightKg, updated_at: new Date().toISOString() })
        .eq("id", productId)
        .eq("producer_id", producerAuth.producer.id)
        .select("id")
        .maybeSingle();

      if (updateRes.error) {
        return jsonNoStore(409, { ok: false, error: "AGRIMARKET_PRODUCT_WEIGHT_UPDATE_FAILED", message: updateRes.error.message });
      }
      if (!updateRes.data) return jsonNoStore(404, { ok: false, error: "AGRIMARKET_PRODUCT_NOT_FOUND" });
    } else if (action === "create") {
      const name = text(body?.name);
      const description = text(body?.description) || null;
      const productGroup = lower(body?.product_group || body?.productGroup);
      const species = text(body?.species) || null;
      const breed = text(body?.breed) || null;
      const meatCut = text(body?.meat_cut || body?.meatCut) || null;
      const processingFormRaw = lower(body?.processing_form || body?.processingForm);
      const processingForm = processingFormRaw || null;
      const condition = lower(body?.condition || "normal");
      const cargoClass = lower(body?.cargo_class || body?.cargoClass);
      const sellingUnit = text(body?.selling_unit || body?.sellingUnit);
      const unitWeightInput = finiteNumber(body?.unit_weight_kg ?? body?.unitWeightKg);
      const unitWeightKg =
        unitWeightInput ??
        (new Set(["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"]).has(lower(sellingUnit)) ? 1 : null);
      const unitPrice = finiteNumber(body?.unit_price ?? body?.unitPrice);
      const availableQuantity = finiteNumber(body?.available_quantity ?? body?.availableQuantity ?? body?.listed_quantity);
      const availabilityMode = lower(body?.availability_mode || body?.availabilityMode || "always_available");
      const harvestStartAt = isoOrNull(body?.harvest_start_at || body?.harvestStartAt);
      const harvestEndAt = isoOrNull(body?.harvest_end_at || body?.harvestEndAt);
      const harvestOrderCutoffAt = isoOrNull(body?.harvest_order_cutoff_at || body?.harvestOrderCutoffAt);
      const prepMinutes = finiteNumber(body?.default_prep_minutes ?? body?.preparation_minutes ?? 15);
      let vehicleRequirement = lower(body?.vehicle_requirement || body?.vehicleRequirement || "either");
      const handlingEligible = body?.handling_eligible === true;
      const photoUrls = Array.isArray(body?.photo_urls)
        ? body.photo_urls.map((value: unknown) => text(value)).filter(Boolean).slice(0, 6)
        : [];

      if (name.length < 2 || !PRODUCT_GROUPS.has(productGroup) || !CONDITIONS.has(condition) ||
          !CARGO_CLASSES.has(cargoClass) || !sellingUnit || (unitWeightKg != null && unitWeightKg <= 0) ||
          unitPrice == null || unitPrice < 0 ||
          availableQuantity == null || availableQuantity < 0 || !AVAILABILITY_MODES.has(availabilityMode) ||
          prepMinutes == null || !Number.isInteger(prepMinutes) || prepMinutes < 0 || prepMinutes > 1440 ||
          !VEHICLES.has(vehicleRequirement) || (processingForm && !PROCESSING_FORMS.has(processingForm))) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_PRODUCT_INPUT_INVALID",
          message: "Check the product category, price, quantity, preparation, cargo, condition, and vehicle fields.",
        });
      }

      if (availabilityMode === "scheduled_harvest") {
        if (!harvestStartAt || !harvestOrderCutoffAt) {
          return jsonNoStore(400, {
            ok: false,
            error: "AGRIMARKET_HARVEST_WINDOW_REQUIRED",
            message: "Scheduled Harvest requires an expected harvest date and an order cutoff.",
          });
        }
        if (Date.parse(harvestOrderCutoffAt) >= Date.parse(harvestStartAt)) {
          return jsonNoStore(400, {
            ok: false,
            error: "AGRIMARKET_HARVEST_CUTOFF_INVALID",
            message: "The reservation cutoff must be before the expected harvest starts.",
          });
        }
        if (harvestEndAt && Date.parse(harvestEndAt) < Date.parse(harvestStartAt)) {
          return jsonNoStore(400, {
            ok: false,
            error: "AGRIMARKET_HARVEST_WINDOW_INVALID",
          });
        }
      }

      if (cargoClass === "live_livestock" || productGroup === "livestock") {
        vehicleRequirement = "tricycle";
      }

      const insertRes = await admin
        .from("agrimarket_products")
        .insert({
          producer_id: producerAuth.producer.id,
          name,
          description,
          product_group: productGroup,
          species,
          breed,
          meat_cut: meatCut,
          processing_form: processingForm,
          condition,
          cargo_class: cargoClass,
          selling_unit: sellingUnit,
          unit_weight_kg: unitWeightKg,
          unit_price: unitPrice,
          listed_quantity: availableQuantity,
          availability_mode: availabilityMode,
          harvest_start_at: availabilityMode === "scheduled_harvest" ? harvestStartAt : null,
          harvest_end_at: availabilityMode === "scheduled_harvest" ? harvestEndAt : null,
          harvest_order_cutoff_at: availabilityMode === "scheduled_harvest" ? harvestOrderCutoffAt : null,
          default_prep_minutes: prepMinutes,
          vehicle_requirement: vehicleRequirement,
          handling_eligible: handlingEligible,
          photo_urls: photoUrls,
          is_active: true,
        })
        .select("id")
        .single();

      if (insertRes.error) {
        return jsonNoStore(409, {
          ok: false,
          error: "AGRIMARKET_PRODUCT_CREATE_FAILED",
          message: insertRes.error.message,
        });
      }
    } else {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PRODUCT_ACTION_INVALID" });
    }

    const productsRes = await readOwnProducts(admin, producerAuth.producer.id);
    if (productsRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_PRODUCTS_FAILED",
        message: productsRes.error.message,
      });
    }

    return jsonNoStore(200, {
      ok: true,
      farmer_fee_policy: "free_launch_v1",
      farmer_wallet_enabled: false,
      products: (Array.isArray(productsRes.data) ? productsRes.data : []).map(productPayload),
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_PRODUCER_PRODUCT_ACTION_FAILED",
      message: String(error?.message || error),
    });
  }
}
