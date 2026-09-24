const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");

(async () => {

function loadTypeScript(relativePath) {
  const filename = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const moduleValue = { exports: {} };
  const runner = new Function("require", "module", "exports", output);
  runner(require, moduleValue, moduleValue.exports);
  return moduleValue.exports;
}

const fare = loadTypeScript("lib/shortTripAutomaticFare.ts");
const elevation = loadTypeScript("lib/routing/openMeteoElevation.ts");

function loadDispatchStatusRoute(config) {
  const filename = path.join(repoRoot, "app/api/dispatch/status/route.ts");
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;

  const supabase = createMockSupabase(config);
  const routeClient = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
  const imports = {
    "@/lib/supabaseAdmin": { supabaseAdmin: () => supabase },
    "next/server": {
      NextRequest: class NextRequest {},
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status || 200 }),
      },
    },
    "@supabase/auth-helpers-nextjs": {
      createRouteHandlerClient: () => routeClient,
    },
    "@supabase/supabase-js": { createClient: () => supabase },
    "next/headers": { cookies: {} },
    "@/lib/shortTripAutomaticPilot": {
      evaluateShortTripAutomaticFare: async (args) => {
        config.evaluationCalls = (config.evaluationCalls || 0) + 1;
        if (config.evaluationError) throw config.evaluationError;
        return config.evaluation;
      },
    },
    "@/lib/shortTripAutomaticFare": {
      isRegularRideServiceType: fare.isRegularRideServiceType,
      SHORT_TRIP_AUTOMATIC_FARE_VERSION: fare.SHORT_TRIP_AUTOMATIC_FARE_VERSION,
    },
  };
  const moduleValue = { exports: {} };
  const localRequire = (request) => imports[request] || require(request);
  const runner = new Function("require", "module", "exports", output);
  runner(localRequire, moduleValue, moduleValue.exports);
  return { route: moduleValue.exports, supabase, config };
}

function createMockSupabase(config) {
  const calls = { updates: [], rpcs: [], updateFilters: [] };
  const booking = {
    id: "booking-1",
    booking_code: "RIDE-1",
    status: "assigned",
    service_type: "motorcycle",
    driver_id: "driver-1",
    assigned_driver_id: "driver-1",
    created_by_user_id: "passenger-1",
    town: "Test Town",
    passenger_fare_response: null,
    driver_accept_expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
    driver_fee_proposal_expires_at: null,
    proposed_fare: null,
    verified_fare: null,
    pickup_distance_fee: 0,
    promo_applied_amount: 0,
    promo_status: config.promoStatus || null,
    promo_program_code: config.promoProgramCode || null,
  };
  const state = {
    ...config,
    booking: { ...booking, ...(config.booking || {}) },
    updateCallCount: 0,
  };

  function queryFor(table) {
    const query = {
      updatePayload: null,
      select() {
        return this;
      },
      limit() {
        return this;
      },
      eq(column, value) {
        calls.updateFilters.push({ column, value });
        return this;
      },
      gt(column, value) {
        calls.updateFilters.push({ column, value, operator: "gt" });
        return this;
      },
      is(column, value) {
        calls.updateFilters.push({ column, value, operator: "is" });
        return this;
      },
      update(payload) {
        this.updatePayload = payload;
        calls.updates.push(payload);
        return this;
      },
      single: async () => ({ data: state.booking, error: null }),
      then(resolve, reject) {
        if (table !== "bookings" || !this.updatePayload) {
          return Promise.resolve({ data: state.booking, error: null }).then(resolve, reject);
        }
        state.updateCallCount += 1;
        const rows = Array.isArray(state.updateRowsByCall)
          ? state.updateRowsByCall[state.updateCallCount - 1] || []
          : state.updatedRows || [{ id: state.booking.id, status: this.updatePayload.status }];
        const error = state.updateError || null;
        return Promise.resolve({ data: rows, error }).then(resolve, reject);
      },
    };
    return query;
  }

  return {
    calls,
    from(table) {
      return queryFor(table);
    },
    rpc(name, args) {
      calls.rpcs.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function makeAutomaticEvaluation() {
  const computedFare = fare.computeShortTripAutomaticFare({
    roadDistanceKm: 1.5,
    validatedCumulativePositiveElevationGainM: 75,
    pickupDistanceFee: 0,
  });
  return {
    outcome: "automatic",
    fallbackReason: null,
    roadDistanceKm: 1.5,
    driverToPickupKm: 0.5,
    pickupEtaMinutes: 2,
    pickupDistanceFee: 0,
    elevation: {
      status: "validated",
      source: "open_meteo_copernicus_glo90",
      version: "open_meteo_elevation_v1",
      cumulativePositiveElevationGainM: 75,
      samplesRequested: 3,
      samplesUsed: 3,
      filteredOutlierCount: 0,
      validationReason: null,
    },
    fare: computedFare,
    snapshot: {
      version: fare.SHORT_TRIP_AUTOMATIC_FARE_VERSION,
      outcome: "automatic",
      provenance: "mapbox_road_open_meteo_glo90_v1",
      automatic_ride_fare: computedFare.automaticRideFare,
      total: computedFare.total,
    },
  };
}

async function callDispatchStatus(route, body) {
  process.env.DRIVER_PING_SECRET = "test-driver-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const request = {
    json: async () => body,
    headers: { get: (name) => (name.toLowerCase() === "x-jride-driver-secret" ? "test-driver-secret" : null) },
  };
  return route.POST(request);
}

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${message}: ${actual} != ${expected}`);
}

const exactlyThreeKm = fare.computeShortTripAutomaticFare({
  roadDistanceKm: 3,
  validatedCumulativePositiveElevationGainM: 25,
});
assert.strictEqual(fare.SHORT_TRIP_AUTOMATIC_PASSENGER_HEADING, "Short Trip - Automatic Fare");
assert.strictEqual(
  fare.SHORT_TRIP_AUTOMATIC_PASSENGER_BODY,
  "This trip is within 3 km. Once a driver accepts, your trip proceeds automatically. No need to wait for a Proposed Fare."
);
assert.strictEqual(fare.SHORT_TRIP_AUTOMATIC_DRIVER_HEADING, "Short Trip - Automatic Fare");
assert.strictEqual(
  fare.SHORT_TRIP_AUTOMATIC_DRIVER_BODY,
  "This trip is within 3 km. Once you accept, proceed to the passenger pickup location. No Proposed Fare is needed."
);
assert.strictEqual(exactlyThreeKm.automaticRideFare, 60);
assert.strictEqual(exactlyThreeKm.total, 75);
assert.strictEqual(exactlyThreeKm.chargeableElevationGainM, 0);
assert.throws(
  () => fare.computeShortTripAutomaticFare({
    roadDistanceKm: 3.000001,
    validatedCumulativePositiveElevationGainM: 25,
  }),
  /SHORT_TRIP_ROAD_DISTANCE_EXCEEDS_LIMIT/
);

const minimumFare = fare.computeShortTripAutomaticFare({
  roadDistanceKm: 0,
  validatedCumulativePositiveElevationGainM: 0,
});
assert.strictEqual(minimumFare.automaticRideFare, 25);
assert.strictEqual(minimumFare.total, 40);
assert.strictEqual(minimumFare.rideMinimumApplied, true);
assert.strictEqual(minimumFare.passengerTotalMinimumApplied, false);

const proportionalPremium = fare.computeShortTripAutomaticFare({
  roadDistanceKm: 1,
  validatedCumulativePositiveElevationGainM: 125,
});
assert.strictEqual(proportionalPremium.chargeableElevationGainM, 100);
assert.strictEqual(proportionalPremium.distanceComponent, 20);
assert.strictEqual(proportionalPremium.elevationPremium, 10);
assert.strictEqual(proportionalPremium.automaticRideFare, 30);
assert.strictEqual(proportionalPremium.total, 45);

const noisy = elevation.validateElevationValues([0, 100, 0], 3, 0.2);
assert.strictEqual(noisy.status, "validated");
assert.strictEqual(noisy.filteredOutlierCount, 1);
assert.strictEqual(noisy.cumulativePositiveElevationGainM, 0);

const missing = elevation.validateElevationValues([0, null, 10], 3, 0.2);
assert.strictEqual(missing.status, "invalid");
assert.strictEqual(missing.cumulativePositiveElevationGainM, null);

const endpointDifferenceIsNotGain = elevation.computeCumulativePositiveElevationGain([0, 20, 5, 15]);
closeTo(endpointDifferenceIsNotGain, 30, "cumulative positive gain");

const sampled = elevation.sampleRoadLineGeometry({
  type: "LineString",
  coordinates: [[121, 16], [121.001, 16.001], [121.002, 16.002]],
});
assert.strictEqual(sampled.length, 3);

const pickupFeeCompatibility = fare.computeShortTripAutomaticFare({
  roadDistanceKm: 1,
  validatedCumulativePositiveElevationGainM: 25,
  pickupDistanceFee: 10,
});
assert.strictEqual(pickupFeeCompatibility.automaticRideFare, 25);
assert.strictEqual(pickupFeeCompatibility.convenienceFee, 15);
assert.strictEqual(pickupFeeCompatibility.total, 50);

const automaticConfig = { evaluation: makeAutomaticEvaluation(), promoStatus: "reserved" };
const automaticRoute = loadDispatchStatusRoute(automaticConfig);
const automaticResponse = await callDispatchStatus(automaticRoute.route, {
  booking_code: "RIDE-1",
  status: "accepted",
});
assert.strictEqual(automaticResponse.status, 200);
assert.deepStrictEqual(automaticResponse.body, {
  ok: true,
  automatic_fare: true,
  status: "ready",
});
const automaticUpdate = automaticRoute.supabase.calls.updates[0];
assert.strictEqual(automaticUpdate.status, "ready");
assert.strictEqual(automaticUpdate.proposed_fare, 35);
assert.strictEqual(automaticUpdate.verified_fare, 35);
assert.strictEqual(automaticUpdate.passenger_fare_response, "accepted");
assert.strictEqual(automaticUpdate.driver_accept_expires_at, null);
assert.strictEqual(automaticUpdate.driver_fee_proposal_expires_at, null);
assert.strictEqual(automaticUpdate.ride_fare_mode, fare.SHORT_TRIP_AUTOMATIC_FARE_VERSION);
assert.strictEqual(automaticUpdate.short_trip_validated_elevation_gain_m, 75);
assert.strictEqual(automaticUpdate.short_trip_elevation_status, "validated");
assert.strictEqual(automaticUpdate.promo_status, undefined);
assert.strictEqual(automaticRoute.supabase.calls.rpcs.length, 1);
assert.strictEqual(automaticRoute.supabase.calls.rpcs[0].name, "record_booking_lifecycle_event");
assert.strictEqual(automaticRoute.supabase.calls.rpcs[0].args.p_event_type, "fare_accepted");
assert.strictEqual(automaticRoute.supabase.calls.rpcs[0].args.p_status_after, "ready");

const fallbackConfig = {
  evaluation: {
    ...makeAutomaticEvaluation(),
    outcome: "fallback",
    fallbackReason: "elevation_unavailable",
    roadDistanceKm: 2,
    elevation: {
      ...makeAutomaticEvaluation().elevation,
      status: "unavailable",
      cumulativePositiveElevationGainM: null,
      validationReason: "elevation_provider_timeout",
    },
    fare: null,
    snapshot: {
      version: fare.SHORT_TRIP_AUTOMATIC_FARE_VERSION,
      outcome: "fallback",
      fallback_reason: "elevation_unavailable",
    },
  },
};
const fallbackRoute = loadDispatchStatusRoute(fallbackConfig);
const fallbackResponse = await callDispatchStatus(fallbackRoute.route, {
  booking_code: "RIDE-1",
  status: "accepted",
});
assert.strictEqual(fallbackResponse.status, 200);
assert.deepStrictEqual(fallbackResponse.body, {
  ok: true,
  automatic_fare: false,
  status: "accepted",
});
const fallbackUpdate = fallbackRoute.supabase.calls.updates[0];
assert.strictEqual(fallbackUpdate.status, "accepted");
assert.strictEqual(fallbackUpdate.driver_accept_expires_at, null);
assert.ok(Date.parse(fallbackUpdate.driver_fee_proposal_expires_at) > Date.now());
assert.strictEqual(fallbackUpdate.ride_fare_mode, null);
assert.strictEqual(fallbackUpdate.short_trip_elevation_status, "unavailable");
assert.strictEqual(fallbackRoute.supabase.calls.rpcs.length, 0);

const staleConfig = { evaluation: makeAutomaticEvaluation() };
staleConfig.booking = {
  driver_accept_expires_at: new Date(Date.now() - 1000).toISOString(),
};
const staleRoute = loadDispatchStatusRoute(staleConfig);
const staleResponse = await callDispatchStatus(staleRoute.route, {
  booking_code: "RIDE-1",
  status: "accepted",
});
assert.strictEqual(staleResponse.status, 409);
assert.strictEqual(staleConfig.evaluationCalls || 0, 0);
assert.strictEqual(staleRoute.supabase.calls.updates.length, 0);

const raceConfig = {
  evaluation: makeAutomaticEvaluation(),
  updateRowsByCall: [[{ id: "booking-1", status: "ready" }], []],
};
const raceRoute = loadDispatchStatusRoute(raceConfig);
const firstRaceResponse = await callDispatchStatus(raceRoute.route, {
  booking_code: "RIDE-1",
  status: "accepted",
});
const secondRaceResponse = await callDispatchStatus(raceRoute.route, {
  booking_code: "RIDE-1",
  status: "accepted",
});
assert.strictEqual(firstRaceResponse.status, 200);
assert.strictEqual(secondRaceResponse.status, 409);
assert.strictEqual(secondRaceResponse.body.error, "status_transition_lost_race");
assert.strictEqual(raceRoute.supabase.calls.updates.length, 2);
assert.strictEqual(raceRoute.supabase.calls.rpcs.length, 1);

const migration = fs.readFileSync(
  path.join(repoRoot, "supabase/migrations/20260924170000_short_trip_automatic_fare_pilot_v1.sql"),
  "utf8"
);
assert.ok(migration.includes("old_status = 'assigned' and new_status = 'ready'"));
assert.ok(migration.includes("coalesce(booking.ride_fare_mode, '') <> 'short_trip_automatic_v1'"));
assert.ok(migration.includes("new.driver_fee_proposal_expires_at is not null"));

const dispatchStatus = fs.readFileSync(
  path.join(repoRoot, "app/api/dispatch/status/route.ts"),
  "utf8"
);
assert.ok(dispatchStatus.includes("accepted_without_proposed_fare"));
assert.ok(dispatchStatus.includes("updatePayload.status = \"ready\""));
assert.ok(dispatchStatus.includes("updatePayload.driver_fee_proposal_expires_at = null"));

console.log("short-trip-automatic-fare: ok");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
