import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { fetchAgrimarketDrivingRoute } from "../_lib/routing";
import {
  agrimarketDisabledResponse,
  agrimarketEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketPassenger,
} from "../_lib/server";

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
  unit_price: number | string;
  remaining_quantity: number | string;
  availability_mode: string;
  harvest_start_at: string | null;
  harvest_end_at: string | null;
  harvest_order_cutoff_at: string | null;
  default_prep_minutes: number;
  vehicle_requirement: string;
  handling_eligible: boolean;
  photo_urls: string[] | null;
};

type ProducerRow = {
  id: string;
  pickup_lat: number;
  pickup_lng: number;
  status: string;
  accepting_orders: boolean;
};

type ProducerRoadMetric = {
  distanceKm: number;
  durationSeconds: number;
};

function cleanUuid(value: string | null): string | null {
  const v = String(value || "").trim();
  if (!v) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    return "INVALID";
  }
  return v;
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundedHalfKm(value: number): number {
  return Math.round(value * 2) / 2;
}

function validFutureIso(value: unknown, nowMs: number): boolean {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) && ms > nowMs;
}

async function loadRoadMetrics(
  producers: ProducerRow[],
  customerLat: number,
  customerLng: number
): Promise<Map<string, ProducerRoadMetric>> {
  const valid = producers.filter((producer) => {
    const lat = Number(producer.pickup_lat);
    const lng = Number(producer.pickup_lng);
    return Number.isFinite(lat) && Number.isFinite(lng);
  });
  const metrics = new Map<string, ProducerRoadMetric>();
  let cursor = 0;

  async function worker() {
    while (cursor < valid.length) {
      const index = cursor;
      cursor += 1;
      const producer = valid[index];
      try {
        const route = await fetchAgrimarketDrivingRoute(
          producer.pickup_lat,
          producer.pickup_lng,
          customerLat,
          customerLng
        );
        metrics.set(producer.id, {
          distanceKm: route.distanceKm,
          durationSeconds: route.durationSeconds,
        });
      } catch {
        // A farmer without a road route is not ranked or displayed for this address.
      }
    }
  }

  const workerCount = Math.min(6, valid.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return metrics;
}

export async function GET(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const passengerAuth = await requireAgrimarketPassenger(req);
    if (passengerAuth.ok === false) return passengerAuth.response;

    const admin = createServiceSupabase();
    const requestedAddressId = cleanUuid(req.nextUrl.searchParams.get("address_id"));
    if (requestedAddressId === "INVALID") {
      return jsonNoStore(400, {
        ok: false,
        error: "INVALID_ADDRESS_ID",
        message: "address_id must be a valid UUID.",
      });
    }

    let addressQuery = admin
      .from("passenger_addresses")
      .select("id,label,address_text,lat,lng,is_primary,updated_at")
      .eq("created_by_user_id", passengerAuth.user.id)
      .eq("is_active", true);

    if (requestedAddressId) {
      addressQuery = addressQuery.eq("id", requestedAddressId);
    } else {
      addressQuery = addressQuery
        .order("is_primary", { ascending: false })
        .order("updated_at", { ascending: false });
    }

    const addressRes = await addressQuery.limit(1).maybeSingle();
    if (addressRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ADDRESS_LOOKUP_FAILED",
        message: addressRes.error.message,
      });
    }

    const address = addressRes.data as any;
    if (!address) {
      return jsonNoStore(404, {
        ok: false,
        error: "AGRIMARKET_ADDRESS_NOT_FOUND",
        message: "No active delivery address was found for this passenger.",
      });
    }

    const customerLat = Number(address.lat);
    const customerLng = Number(address.lng);
    if (!Number.isFinite(customerLat) || !Number.isFinite(customerLng)) {
      return jsonNoStore(409, {
        ok: false,
        error: "AGRIMARKET_DELIVERY_PIN_REQUIRED",
        message: "The selected delivery address needs a valid map pin.",
      });
    }

    const pricingRes = await admin
      .from("agrimarket_pricing_settings")
      .select("pricing_version,currency,base_delivery_fee,route_fee_per_km,rounding_mode")
      .eq("id", 1)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (pricingRes.error || !pricingRes.data) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_PRICING_UNAVAILABLE",
        message: pricingRes.error?.message || "Agrimarket pricing is not configured.",
      });
    }

    const productRes = await admin
      .from("agrimarket_products")
      .select(
        "id,producer_id,name,description,product_group,species,breed,meat_cut,processing_form,condition,cargo_class,selling_unit,unit_price,remaining_quantity,availability_mode,harvest_start_at,harvest_end_at,harvest_order_cutoff_at,default_prep_minutes,vehicle_requirement,handling_eligible,photo_urls"
      )
      .eq("is_active", true)
      .gt("remaining_quantity", 0)
      .limit(500);

    if (productRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_CATALOG_QUERY_FAILED",
        message: productRes.error.message,
      });
    }

    const products = (Array.isArray(productRes.data) ? productRes.data : []) as ProductRow[];
    const producerIds = Array.from(new Set(products.map((row) => row.producer_id).filter(Boolean)));

    const baseResponse = {
      ok: true,
      ordering_enabled: true,
      address: { id: address.id, label: address.label || address.address_text },
      delivery_pricing: {
        pricing_version: Number((pricingRes.data as any).pricing_version || 1),
        currency: String((pricingRes.data as any).currency || "PHP"),
        base_fee: numberValue((pricingRes.data as any).base_delivery_fee),
        rate_per_road_km: numberValue((pricingRes.data as any).route_fee_per_km),
        rounding_mode: String((pricingRes.data as any).rounding_mode || "nearest_whole_peso"),
        route_basis: "road_route",
      },
      ranking_basis: "road_route_proximity_to_selected_delivery_pin",
      producer_location_disclosure: "hidden",
      cart_policy: "single_farmer_single_fulfillment_mode",
    };

    if (!producerIds.length) {
      return jsonNoStore(200, { ...baseResponse, products: [] });
    }

    const producerRes = await admin
      .from("agrimarket_producers")
      .select("id,pickup_lat,pickup_lng,status,accepting_orders")
      .in("id", producerIds)
      .eq("status", "active")
      .eq("accepting_orders", true);

    if (producerRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_QUERY_FAILED",
        message: producerRes.error.message,
      });
    }

    const producers = (Array.isArray(producerRes.data) ? producerRes.data : []) as ProducerRow[];
    const producerById = new Map<string, ProducerRow>();
    for (const producer of producers) producerById.set(producer.id, producer);

    const roadMetrics = await loadRoadMetrics(producers, customerLat, customerLng);
    const rankByProductAndProducer = new Map<string, number>();
    const cartGroupByProducer = new Map<string, string>();
    const productNames = Array.from(new Set(products.map((row) => row.name.trim().toLowerCase())));

    for (const producer of producers) cartGroupByProducer.set(producer.id, randomUUID());

    for (const normalizedName of productNames) {
      const ids = Array.from(
        new Set(
          products
            .filter((row) => row.name.trim().toLowerCase() === normalizedName)
            .map((row) => row.producer_id)
            .filter((producerId) => producerById.has(producerId) && roadMetrics.has(producerId))
        )
      );

      ids.sort((a, b) => {
        const da = roadMetrics.get(a)?.distanceKm ?? Number.POSITIVE_INFINITY;
        const db = roadMetrics.get(b)?.distanceKm ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return a.localeCompare(b);
      });

      ids.forEach((producerId, index) => {
        rankByProductAndProducer.set(`${normalizedName}|${producerId}`, index + 1);
      });
    }

    const nowMs = Date.now();
    const safeProducts = products
      .filter((row) => producerById.has(row.producer_id) && roadMetrics.has(row.producer_id))
      .map((row) => {
        const normalizedName = row.name.trim().toLowerCase();
        const proximityRank = rankByProductAndProducer.get(`${normalizedName}|${row.producer_id}`) || 1;
        const scheduledHarvest = row.availability_mode === "scheduled_harvest";
        const metric = roadMetrics.get(row.producer_id)!;
        const reservationOpen = !scheduledHarvest || validFutureIso(row.harvest_order_cutoff_at, nowMs);
        const harvestWindowKey = scheduledHarvest
          ? `${row.harvest_start_at || ""}|${row.harvest_end_at || row.harvest_start_at || ""}`
          : "always_available";

        return {
          id: row.id,
          name: row.name,
          producer_alias: `${row.name} Farmer ${proximityRank}`,
          proximity_rank: proximityRank,
          cart_group_key: cartGroupByProducer.get(row.producer_id),
          harvest_window_key: harvestWindowKey,
          approximate_road_distance_km: roundedHalfKm(metric.distanceKm),
          approximate_road_duration_minutes: Math.max(1, Math.round(metric.durationSeconds / 60)),
          distance_disclosure: "road_route_rounded_to_nearest_0_5_km",
          description: row.description,
          product_group: row.product_group,
          species: row.species,
          breed: row.breed,
          meat_cut: row.meat_cut,
          processing_form: row.processing_form,
          condition: row.condition,
          cargo_class: row.cargo_class,
          selling_unit: row.selling_unit,
          unit_price: numberValue(row.unit_price),
          remaining_quantity: numberValue(row.remaining_quantity),
          availability_mode: row.availability_mode,
          harvest_start_at: row.harvest_start_at,
          harvest_end_at: row.harvest_end_at,
          harvest_order_cutoff_at: row.harvest_order_cutoff_at,
          preparation_minutes: row.default_prep_minutes,
          vehicle_requirement: row.vehicle_requirement,
          handling_eligible: row.handling_eligible,
          photo_urls: Array.isArray(row.photo_urls) ? row.photo_urls : [],
          can_order_now: reservationOpen,
          order_action: scheduledHarvest ? "Reserve harvest" : "Add to cart",
          order_blocker: reservationOpen ? null : "AGRIMARKET_HARVEST_ORDER_CUTOFF_PASSED",
        };
      })
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        if (a.proximity_rank !== b.proximity_rank) return a.proximity_rank - b.proximity_rank;
        return a.unit_price - b.unit_price;
      });

    return jsonNoStore(200, { ...baseResponse, products: safeProducts });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_CATALOG_FAILED",
      message: String(error?.message || error),
    });
  }
}
