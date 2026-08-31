import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDrivingRoadMetricsToTarget } from "@/lib/routing/mapboxRoad";

const DRIVER_STALE_AFTER_SECONDS = 120;
const DRIVER_ACCEPT_TTL_SECONDS = 300;
const ONLINE_LIKE = new Set(["online", "available", "idle", "waiting"]);
const ACTIVE_BOOKING_STATUSES = [
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
];
const ACTIVE_AGRIMARKET_STATUSES = ["driver_assigned", "picked_up", "delivering"];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageSeconds(value: unknown): number | null {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
}

function normalizeVehicle(value: unknown): "motorcycle" | "tricycle" | "" {
  const raw = lower(value);
  if (raw.includes("motor") || raw.includes("moto") || raw.includes("bike")) {
    return "motorcycle";
  }
  if (raw.includes("trike") || raw.includes("tricycle") || raw.includes("toda")) {
    return "tricycle";
  }
  return "";
}

function effectiveMinWallet(value: unknown): number {
  const configured = numberOrNull(value);
  return configured != null && configured >= 250 ? configured : 250;
}

function isUniqueViolation(error: any): boolean {
  return text(error?.code) === "23505" || lower(error?.message).includes("duplicate key");
}

function computeAgrimarketApproachFee(input: {
  distanceKm: number;
  freeKm: number;
  feePerStartedKm: number;
  feeCap: number;
}): number {
  const distanceKm = Number(input.distanceKm.toFixed(3));
  const freeKm = Number(input.freeKm.toFixed(3));

  if (
    !Number.isFinite(distanceKm) ||
    distanceKm < 0 ||
    !Number.isFinite(freeKm) ||
    freeKm < 0 ||
    !Number.isFinite(input.feePerStartedKm) ||
    input.feePerStartedKm < 0 ||
    !Number.isFinite(input.feeCap) ||
    input.feeCap < 0
  ) {
    throw new RangeError("AGRIMARKET_DRIVER_APPROACH_SETTINGS_INVALID");
  }

  if (distanceKm <= freeKm) return 0;

  const chargeableKm = Math.max(0, distanceKm - freeKm);
  const startedKm = Math.max(0, Math.ceil(chargeableKm - 1e-9));
  return Number(
    Math.min(input.feeCap, startedKm * input.feePerStartedKm).toFixed(2)
  );
}

export type AgrimarketDispatchResult = {
  ok: boolean;
  order_id?: string;
  order_code?: string;
  offered?: boolean;
  assigned?: boolean;
  offer_id?: string;
  driver_id?: string;
  offer_rank?: number;
  assignment_anchor?: "customer" | "farmer";
  pickup_road_distance_km?: number;
  driver_approach_distance_km?: number;
  pickup_distance_fee?: number;
  eta_seconds_to_first_pickup?: number;
  eta_seconds_to_farmer?: number;
  remaining_preparation_seconds?: number;
  driver_accept_expires_at?: string;
  error?: string;
  message?: string;
};

export async function offerAgrimarketDriver(input: {
  orderId?: string | null;
  orderCode?: string | null;
}): Promise<AgrimarketDispatchResult> {
  const admin = supabaseAdmin();
  const orderId = text(input.orderId);
  const orderCode = text(input.orderCode);

  if (!orderId && !orderCode) {
    return { ok: false, error: "AGRIMARKET_ORDER_REQUIRED" };
  }

  let orderQuery = admin.from("agrimarket_orders").select("*").limit(1);
  orderQuery = orderId ? orderQuery.eq("id", orderId) : orderQuery.eq("order_code", orderCode);
  const orderRes = await orderQuery.maybeSingle();

  if (orderRes.error) {
    return { ok: false, error: "AGRIMARKET_ORDER_READ_FAILED", message: orderRes.error.message };
  }
  if (!orderRes.data) return { ok: false, error: "AGRIMARKET_ORDER_NOT_FOUND" };

  const order: any = orderRes.data;
  const resolvedOrderId = text(order.id);
  const resolvedOrderCode = text(order.order_code);

  if (text(order.assigned_driver_id)) {
    return {
      ok: true,
      order_id: resolvedOrderId,
      order_code: resolvedOrderCode,
      assigned: true,
      driver_id: text(order.assigned_driver_id),
    };
  }

  if (!["preparing", "ready_for_dispatch", "dispatching"].includes(lower(order.status))) {
    return {
      ok: false,
      order_id: resolvedOrderId,
      order_code: resolvedOrderCode,
      error: "AGRIMARKET_ORDER_NOT_DISPATCHABLE",
      message: text(order.status),
    };
  }

  const now = new Date();
  const nowIso = now.toISOString();

  const offeredRes = await admin
    .from("agrimarket_driver_offers")
    .select(
      "id,driver_id,offer_rank,assignment_anchor,pickup_road_distance_km,pickup_distance_fee,estimated_seconds_to_first_pickup,estimated_seconds_to_farmer,expires_at"
    )
    .eq("order_id", resolvedOrderId)
    .eq("status", "offered")
    .gt("expires_at", nowIso)
    .order("offered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (offeredRes.error) {
    return { ok: false, error: "AGRIMARKET_ACTIVE_OFFER_READ_FAILED", message: offeredRes.error.message };
  }
  if (offeredRes.data) {
    const active: any = offeredRes.data;
    const activeAnchor: "customer" | "farmer" =
      lower(active.assignment_anchor) === "customer" ? "customer" : "farmer";
    const activeFirstPickupKm = Number(active.pickup_road_distance_km || 0);
    const activeCustomerToFarmerKm =
      activeAnchor === "customer"
        ? Math.max(0, numberOrNull(order.customer_to_farmer_distance_km) ?? 0)
        : 0;

    return {
      ok: true,
      order_id: resolvedOrderId,
      order_code: resolvedOrderCode,
      offered: true,
      offer_id: text(active.id),
      driver_id: text(active.driver_id),
      offer_rank: Number(active.offer_rank || 1),
      assignment_anchor: activeAnchor,
      pickup_road_distance_km: activeFirstPickupKm,
      driver_approach_distance_km: Number(
        (activeFirstPickupKm + activeCustomerToFarmerKm).toFixed(3)
      ),
      pickup_distance_fee: Number(active.pickup_distance_fee || 0),
      eta_seconds_to_first_pickup: numberOrNull(active.estimated_seconds_to_first_pickup) ?? undefined,
      eta_seconds_to_farmer: numberOrNull(active.estimated_seconds_to_farmer) ?? undefined,
      driver_accept_expires_at: text(active.expires_at),
    };
  }

  const expireRes = await admin
    .from("agrimarket_driver_offers")
    .update({
      status: "expired",
      responded_at: nowIso,
      reason_code: "offer_timeout",
      updated_at: nowIso,
    })
    .eq("order_id", resolvedOrderId)
    .eq("status", "offered")
    .lte("expires_at", nowIso);

  if (expireRes.error) {
    return { ok: false, error: "AGRIMARKET_OFFER_EXPIRY_FAILED", message: expireRes.error.message };
  }

  const approachSettingsRes = await admin
    .from("agrimarket_pricing_settings")
    .select(
      "driver_approach_free_km,driver_approach_fee_per_started_km,driver_approach_fee_cap"
    )
    .eq("id", 1)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (approachSettingsRes.error || !approachSettingsRes.data) {
    return {
      ok: false,
      error: "AGRIMARKET_DRIVER_APPROACH_SETTINGS_READ_FAILED",
      message: approachSettingsRes.error?.message,
    };
  }

  const approachFreeKm = numberOrNull(
    (approachSettingsRes.data as any).driver_approach_free_km
  );
  const approachFeePerStartedKm = numberOrNull(
    (approachSettingsRes.data as any).driver_approach_fee_per_started_km
  );
  const approachFeeCap = numberOrNull(
    (approachSettingsRes.data as any).driver_approach_fee_cap
  );

  if (
    approachFreeKm == null ||
    approachFreeKm < 0 ||
    approachFeePerStartedKm == null ||
    approachFeePerStartedKm < 0 ||
    approachFeeCap == null ||
    approachFeeCap < 0
  ) {
    return { ok: false, error: "AGRIMARKET_DRIVER_APPROACH_SETTINGS_INVALID" };
  }

  const producerRes = await admin
    .from("agrimarket_producers")
    .select("id,pickup_lat,pickup_lng,status,accepting_orders")
    .eq("id", order.producer_id)
    .limit(1)
    .maybeSingle();

  if (producerRes.error || !producerRes.data) {
    return {
      ok: false,
      error: "AGRIMARKET_PRODUCER_READ_FAILED",
      message: producerRes.error?.message,
    };
  }

  const assignmentAnchor: "customer" | "farmer" =
    lower(order.assignment_anchor) === "customer" ? "customer" : "farmer";
  const targetLat = numberOrNull(
    assignmentAnchor === "customer" ? order.delivery_lat : (producerRes.data as any).pickup_lat
  );
  const targetLng = numberOrNull(
    assignmentAnchor === "customer" ? order.delivery_lng : (producerRes.data as any).pickup_lng
  );

  if (targetLat == null || targetLng == null) {
    return { ok: false, error: "AGRIMARKET_ASSIGNMENT_ANCHOR_LOCATION_MISSING" };
  }

  const preferredVehicle = normalizeVehicle(order.preferred_vehicle_type);
  if (!preferredVehicle) {
    return { ok: false, error: "AGRIMARKET_PREFERRED_VEHICLE_INVALID" };
  }
  if (lower(order.required_vehicle_type) === "tricycle" && preferredVehicle !== "tricycle") {
    return { ok: false, error: "AGRIMARKET_TRICYCLE_REQUIRED" };
  }

  const priorOffersRes = await admin
    .from("agrimarket_driver_offers")
    .select("driver_id")
    .eq("order_id", resolvedOrderId);
  if (priorOffersRes.error) {
    return { ok: false, error: "AGRIMARKET_PRIOR_OFFERS_READ_FAILED", message: priorOffersRes.error.message };
  }
  const excludedDrivers = new Set(
    (Array.isArray(priorOffersRes.data) ? priorOffersRes.data : [])
      .map((row: any) => text(row.driver_id))
      .filter(Boolean)
  );

  const locationsRes = await admin
    .from("driver_locations")
    .select("driver_id,status,updated_at,lat,lng,town,home_town,vehicle_type");
  if (locationsRes.error) {
    return { ok: false, error: "AGRIMARKET_DRIVER_LOCATION_READ_FAILED", message: locationsRes.error.message };
  }

  const latestByDriver = new Map<string, any>();
  for (const row of Array.isArray(locationsRes.data) ? locationsRes.data : []) {
    const driverId = text((row as any).driver_id);
    if (!driverId || excludedDrivers.has(driverId)) continue;
    const previous = latestByDriver.get(driverId);
    const previousTime = previous ? Date.parse(text(previous.updated_at)) || 0 : 0;
    const nextTime = Date.parse(text((row as any).updated_at)) || 0;
    if (!previous || nextTime >= previousTime) latestByDriver.set(driverId, row);
  }

  let locations = Array.from(latestByDriver.values()).filter((row: any) => {
    const age = ageSeconds(row.updated_at);
    const lat = numberOrNull(row.lat);
    const lng = numberOrNull(row.lng);
    return (
      age != null &&
      age <= DRIVER_STALE_AFTER_SECONDS &&
      ONLINE_LIKE.has(lower(row.status)) &&
      lat != null &&
      lng != null &&
      normalizeVehicle(row.vehicle_type) === preferredVehicle
    );
  });

  if (!locations.length) {
    return {
      ok: true,
      order_id: resolvedOrderId,
      order_code: resolvedOrderCode,
      offered: false,
      error: "NO_PREFERRED_VEHICLE_DRIVER_AVAILABLE",
      assignment_anchor: assignmentAnchor,
    };
  }

  const candidateIds = locations.map((row: any) => text(row.driver_id));
  const driversRes = await admin
    .from("drivers")
    .select("id,wallet_balance,min_wallet_required,wallet_locked,roster_status")
    .in("id", candidateIds);
  if (driversRes.error) {
    return { ok: false, error: "AGRIMARKET_DRIVER_READ_FAILED", message: driversRes.error.message };
  }

  const driverById = new Map<string, any>();
  for (const row of Array.isArray(driversRes.data) ? driversRes.data : []) {
    driverById.set(text((row as any).id), row);
  }

  const activeBookingsRes = await admin
    .from("bookings")
    .select("driver_id,assigned_driver_id")
    .in("status", ACTIVE_BOOKING_STATUSES)
    .or(`driver_id.in.(${candidateIds.join(",")}),assigned_driver_id.in.(${candidateIds.join(",")})`);
  if (activeBookingsRes.error) {
    return { ok: false, error: "AGRIMARKET_ACTIVE_BOOKINGS_READ_FAILED", message: activeBookingsRes.error.message };
  }

  const busyDrivers = new Set<string>();
  for (const row of Array.isArray(activeBookingsRes.data) ? activeBookingsRes.data : []) {
    const direct = text((row as any).driver_id);
    const assigned = text((row as any).assigned_driver_id);
    if (direct) busyDrivers.add(direct);
    if (assigned) busyDrivers.add(assigned);
  }

  const activeAgriRes = await admin
    .from("agrimarket_orders")
    .select("assigned_driver_id")
    .in("assigned_driver_id", candidateIds)
    .in("status", ACTIVE_AGRIMARKET_STATUSES);
  if (activeAgriRes.error) {
    return { ok: false, error: "AGRIMARKET_ACTIVE_DRIVER_READ_FAILED", message: activeAgriRes.error.message };
  }
  for (const row of Array.isArray(activeAgriRes.data) ? activeAgriRes.data : []) {
    const driverId = text((row as any).assigned_driver_id);
    if (driverId) busyDrivers.add(driverId);
  }

  const activeOffersRes = await admin
    .from("agrimarket_driver_offers")
    .select("driver_id")
    .in("driver_id", candidateIds)
    .eq("status", "offered")
    .gt("expires_at", nowIso);
  if (activeOffersRes.error) {
    return { ok: false, error: "AGRIMARKET_ACTIVE_DRIVER_OFFER_READ_FAILED", message: activeOffersRes.error.message };
  }
  for (const row of Array.isArray(activeOffersRes.data) ? activeOffersRes.data : []) {
    const driverId = text((row as any).driver_id);
    if (driverId) busyDrivers.add(driverId);
  }

  locations = locations.filter((row: any) => {
    const driverId = text(row.driver_id);
    const driver = driverById.get(driverId);
    if (!driver || busyDrivers.has(driverId)) return false;

    const rosterStatus = lower(driver.roster_status);
    const rosterEligible = !rosterStatus || rosterStatus === "active";
    const walletBalance = numberOrNull(driver.wallet_balance) ?? 0;
    const minimumWallet = effectiveMinWallet(driver.min_wallet_required);
    return !Boolean(driver.wallet_locked) && rosterEligible && walletBalance >= minimumWallet;
  });

  if (!locations.length) {
    return {
      ok: true,
      order_id: resolvedOrderId,
      order_code: resolvedOrderCode,
      offered: false,
      error: "NO_ELIGIBLE_DRIVER_AVAILABLE",
      assignment_anchor: assignmentAnchor,
    };
  }

  const roadMetrics = await getDrivingRoadMetricsToTarget(
    { lat: targetLat, lng: targetLng },
    locations.map((row: any) => ({
      id: text(row.driver_id),
      lat: Number(row.lat),
      lng: Number(row.lng),
    }))
  );

  const ranked = locations
    .map((row: any) => ({
      driverId: text(row.driver_id),
      metric: roadMetrics.get(text(row.driver_id)) || null,
    }))
    .filter(
      (entry) =>
        entry.metric != null &&
        entry.metric.durationSeconds != null &&
        Number.isFinite(entry.metric.distanceKm) &&
        entry.metric.distanceKm >= 0
    )
    .sort((a, b) => (a.metric?.distanceKm || 0) - (b.metric?.distanceKm || 0));

  if (!ranked.length) {
    return {
      ok: true,
      order_id: resolvedOrderId,
      order_code: resolvedOrderCode,
      offered: false,
      error: "ROAD_DISTANCE_UNAVAILABLE",
      assignment_anchor: assignmentAnchor,
    };
  }

  const nearest = ranked[0];
  if (!nearest.metric || nearest.metric.durationSeconds == null) {
    return { ok: false, error: "AGRIMARKET_NEAREST_DRIVER_ROUTE_MISSING" };
  }

  const etaToFirstPickup = Math.round(nearest.metric.durationSeconds);
  const customerToFarmerSeconds =
    assignmentAnchor === "customer"
      ? Math.max(0, numberOrNull(order.customer_to_farmer_duration_seconds) ?? 0)
      : 0;
  const etaToFarmer = etaToFirstPickup + customerToFarmerSeconds;
  const readyAtMs = Date.parse(text(order.ready_at));
  const remainingPreparationSeconds = Number.isFinite(readyAtMs)
    ? Math.max(0, Math.ceil((readyAtMs - now.getTime()) / 1000))
    : 0;

  if (remainingPreparationSeconds > etaToFarmer + DRIVER_ACCEPT_TTL_SECONDS) {
    return {
      ok: true,
      order_id: resolvedOrderId,
      order_code: resolvedOrderCode,
      offered: false,
      error: "AGRIMARKET_DISPATCH_TOO_EARLY",
      assignment_anchor: assignmentAnchor,
      driver_id: nearest.driverId,
      pickup_road_distance_km: Number(nearest.metric.distanceKm.toFixed(3)),
      eta_seconds_to_first_pickup: etaToFirstPickup,
      eta_seconds_to_farmer: etaToFarmer,
      remaining_preparation_seconds: remainingPreparationSeconds,
    };
  }

  const pickupDistanceKm = Number(nearest.metric.distanceKm.toFixed(3));
  const customerToFarmerDistanceKm =
    assignmentAnchor === "customer"
      ? numberOrNull(order.customer_to_farmer_distance_km)
      : 0;

  if (assignmentAnchor === "customer" && customerToFarmerDistanceKm == null) {
    return { ok: false, error: "AGRIMARKET_DRIVER_APPROACH_CUSTOMER_FARMER_ROUTE_REQUIRED" };
  }

  const driverApproachDistanceKm = Number(
    (
      pickupDistanceKm +
      Math.max(0, customerToFarmerDistanceKm ?? 0)
    ).toFixed(3)
  );
  const pickupFee = computeAgrimarketApproachFee({
    distanceKm: driverApproachDistanceKm,
    freeKm: approachFreeKm,
    feePerStartedKm: approachFeePerStartedKm,
    feeCap: approachFeeCap,
  });

  const priorCountRes = await admin
    .from("agrimarket_driver_offers")
    .select("id", { count: "exact", head: true })
    .eq("order_id", resolvedOrderId);
  if (priorCountRes.error) {
    return { ok: false, error: "AGRIMARKET_OFFER_RANK_READ_FAILED", message: priorCountRes.error.message };
  }

  const offerRank = Number(priorCountRes.count || 0) + 1;
  const expiresAt = new Date(now.getTime() + DRIVER_ACCEPT_TTL_SECONDS * 1000).toISOString();
  const insertRes = await admin
    .from("agrimarket_driver_offers")
    .insert({
      order_id: resolvedOrderId,
      driver_id: nearest.driverId,
      offer_rank: offerRank,
      status: "offered",
      assignment_anchor: assignmentAnchor,
      pickup_road_distance_km: pickupDistanceKm,
      pickup_distance_fee: pickupFee,
      estimated_seconds_to_first_pickup: etaToFirstPickup,
      estimated_seconds_to_farmer: etaToFarmer,
      offered_at: nowIso,
      expires_at: expiresAt,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id,pickup_distance_fee")
    .single();

  if (insertRes.error) {
    if (isUniqueViolation(insertRes.error)) {
      return {
        ok: true,
        order_id: resolvedOrderId,
        order_code: resolvedOrderCode,
        offered: false,
        error: "AGRIMARKET_DRIVER_OFFER_RACE_LOST",
      };
    }
    return { ok: false, error: "AGRIMARKET_DRIVER_OFFER_INSERT_FAILED", message: insertRes.error.message };
  }

  const storedPickupFee =
    numberOrNull((insertRes.data as any).pickup_distance_fee) ?? pickupFee;

  const updateRes = await admin
    .from("agrimarket_orders")
    .update({
      status: "dispatching",
      dispatch_started_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", resolvedOrderId)
    .is("assigned_driver_id", null)
    .in("status", ["preparing", "ready_for_dispatch", "dispatching"]);

  if (updateRes.error) {
    await admin
      .from("agrimarket_driver_offers")
      .update({ status: "cancelled", reason_code: "order_update_failed", updated_at: nowIso })
      .eq("id", insertRes.data.id);
    return { ok: false, error: "AGRIMARKET_ORDER_DISPATCH_UPDATE_FAILED", message: updateRes.error.message };
  }

  await admin.from("agrimarket_order_events").insert({
    order_id: resolvedOrderId,
    from_status: lower(order.status),
    to_status: "dispatching",
    actor_type: "system",
    reason_code: "driver_offer_created",
    details: {
      offer_id: insertRes.data.id,
      driver_id: nearest.driverId,
      offer_rank: offerRank,
      assignment_anchor: assignmentAnchor,
      pickup_road_distance_km: pickupDistanceKm,
      driver_approach_distance_km: driverApproachDistanceKm,
      driver_approach_fee_rule: "agrimarket_driver_approach_v1",
      driver_approach_free_km: approachFreeKm,
      driver_approach_fee_per_started_km: approachFeePerStartedKm,
      driver_approach_fee_cap: approachFeeCap,
      pickup_distance_fee: storedPickupFee,
      eta_seconds_to_first_pickup: etaToFirstPickup,
      eta_seconds_to_farmer: etaToFarmer,
      remaining_preparation_seconds: remainingPreparationSeconds,
    },
    created_at: nowIso,
  });

  return {
    ok: true,
    order_id: resolvedOrderId,
    order_code: resolvedOrderCode,
    offered: true,
    offer_id: text(insertRes.data.id),
    driver_id: nearest.driverId,
    offer_rank: offerRank,
    assignment_anchor: assignmentAnchor,
    pickup_road_distance_km: pickupDistanceKm,
    driver_approach_distance_km: driverApproachDistanceKm,
    pickup_distance_fee: storedPickupFee,
    eta_seconds_to_first_pickup: etaToFirstPickup,
    eta_seconds_to_farmer: etaToFarmer,
    remaining_preparation_seconds: remainingPreparationSeconds,
    driver_accept_expires_at: expiresAt,
  };
}
