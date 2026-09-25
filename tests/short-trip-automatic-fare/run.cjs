const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../..");

(async () => {

function loadTypeScript(relativePath, imports = {}) {
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
  runner((name) => imports[name] || require(name), moduleValue, moduleValue.exports);
  return moduleValue.exports;
}

const fare = loadTypeScript("lib/shortTripAutomaticFare.ts");
const elevation = loadTypeScript("lib/routing/mapboxTerrainElevation.ts");

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
        if (config.onEvaluate) config.onEvaluate();
        return config.evaluation;
      },
    },
    "@/lib/shortTripAutomaticFare": {
      isRegularRideServiceType: fare.isRegularRideServiceType,
      SHORT_TRIP_AUTOMATIC_FARE_VERSION: fare.SHORT_TRIP_AUTOMATIC_FARE_VERSION,
      SHORT_TRIP_MAX_ROAD_DISTANCE_KM: fare.SHORT_TRIP_MAX_ROAD_DISTANCE_KM,
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
      source: elevation.MAPBOX_ELEVATION_SOURCE,
      version: elevation.MAPBOX_ELEVATION_VERSION,
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
      provenance: elevation.MAPBOX_FARE_PROVENANCE,
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

for (const [rawFare, expected] of [[29.499, 29], [29.5, 30], [29.501, 30], [29.75, 30], [25.49, 25], [25.5, 26]]) {
  const rounded = fare.computeShortTripAutomaticFare({ roadDistanceKm: rawFare / 20, validatedCumulativePositiveElevationGainM: 0 });
  assert.strictEqual(rounded.automaticRideFare, expected);
  assert.strictEqual(rounded.total, expected + 15);
  assert.strictEqual(rounded.rideMinimumApplied, false, "Rounding is not minimum application");
  closeTo(rounded.rideFareRoundingAdjustment, expected - rawFare, "rounding audit");
  assert.strictEqual(rounded.roundingVersion, "ride_fare_nearest_peso_half_up_v1");
}
const recordedRoute = fare.computeShortTripAutomaticFare({ roadDistanceKm: 1.487257, validatedCumulativePositiveElevationGainM: 14, pickupDistanceFee: 100 });
assert.strictEqual(recordedRoute.automaticRideFare, 30);
assert.strictEqual(recordedRoute.total, 145);
assert.strictEqual(recordedRoute.chargeableElevationGainM, 0);
assert.strictEqual(recordedRoute.minimumApplied, false);
closeTo(recordedRoute.rideFareBeforeRounding, 29.74514, "unrounded formula audit");
const fractionalUphill = fare.computeShortTripAutomaticFare({ roadDistanceKm: 1.5, validatedCumulativePositiveElevationGainM: 29.9 });
assert.strictEqual(fractionalUphill.elevationPremium, 0.49);
assert.strictEqual(fractionalUphill.automaticRideFare, 30);
assert.strictEqual(fare.computeShortTripAutomaticFare({ roadDistanceKm: 1.5, validatedCumulativePositiveElevationGainM: 30 }).automaticRideFare, 31);

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
assert.ok(sampled.length > 3, "Sparse geometry is sampled along the road, not just at its vertices");
assert.deepStrictEqual(sampled[0], { latitude: 16, longitude: 121 });
assert.deepStrictEqual(sampled[sampled.length - 1], { latitude: 16.002, longitude: 121.002 });
assert.strictEqual(elevation.sampleRoadLineGeometry({ type: "LineString", coordinates: [[121,16],[null,16.001],[121.002,16.002]] }), null);
assert.strictEqual(elevation.computeCumulativePositiveElevationGain([100,101,100,101,100]), 0);
closeTo(elevation.computeCumulativePositiveElevationGain([100,110,109,120,119,130]), 30, "Small reversals do not inflate gain");
assert.strictEqual(elevation.validateElevationValues([100,150,200], 3, 0.1).status, "invalid");
assert.strictEqual(elevation.validateElevationValues([100,true,120], 3, 0.2).status, "invalid");
const fractionalAllowance = fare.computeShortTripAutomaticFare({ roadDistanceKm: 2, validatedCumulativePositiveElevationGainM: 25.1 });
assert.strictEqual(fractionalAllowance.elevationPremium, 0.01);

const elevationGeometry = {
  type: "LineString",
  coordinates: [[121, 16], [121.001, 16.001], [121.002, 16.002]],
};
const previousNodeEnv = process.env.NODE_ENV;
const tokenNames = ["MAPBOX_ACCESS_TOKEN", "MAPBOX_TOKEN", "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "NEXT_PUBLIC_MAPBOX_TOKEN"];
const previousTokens = tokenNames.map(name => process.env[name]);
const previousFetch = global.fetch;
try {
  process.env.NODE_ENV = "production";
  tokenNames.forEach(name => delete process.env[name]);
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch should not run without production elevation credentials");
  };
  const missingProvider = await elevation.getValidatedCumulativePositiveElevationGain(
    elevationGeometry,
    0.31
  );
  assert.strictEqual(missingProvider.status, "unavailable");
  assert.strictEqual(missingProvider.validationReason, "elevation_provider_credentials_missing");
  assert.strictEqual(fetchCalls, 0);

  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "test-mapbox-token";
  const sharp = require("sharp");
  const raw = Buffer.alloc(512 * 512 * 4);
  const encoded = Math.round((100 + 10000) * 10);
  for (let i = 0; i < raw.length; i += 4) {
    raw[i] = encoded >> 16; raw[i+1] = (encoded >> 8) & 255; raw[i+2] = encoded & 255; raw[i+3] = 255;
  }
  const png = await sharp(raw, { raw: {width:512,height:512,channels:4} }).png().toBuffer();
  global.fetch = async (requestUrl) => {
    fetchCalls += 1;
    assert.ok(String(requestUrl).startsWith("https://api.mapbox.com/v4/mapbox.terrain-rgb/14/"));
    assert.ok(String(requestUrl).includes("@2x.pngraw?access_token=test-mapbox-token"));
    return new Response(png, {headers:{"content-type":"image/png"}});
  };
  const results = await Promise.all([1,2].map(() => elevation.getValidatedCumulativePositiveElevationGain(elevationGeometry, 0.31)));
  for (const value of results) {
    assert.strictEqual(value.status, "validated");
    assert.strictEqual(value.cumulativePositiveElevationGainM, 0);
    assert.strictEqual(value.source, "mapbox_terrain_rgb_v1");
  }
  const initialCalls = fetchCalls;
  assert.ok(initialCalls > 0 && initialCalls <= 4);
  await elevation.getValidatedCumulativePositiveElevationGain(elevationGeometry, 0.31);
  assert.strictEqual(fetchCalls, initialCalls, "Repeated and concurrent calls reuse terrain tiles");
  assert.strictEqual((await elevation.getValidatedCumulativePositiveElevationGain(elevationGeometry, 0.9)).validationReason, "road_geometry_distance_mismatch");

  for (const status of [400,401,403,404,429,500]) {
    const provider = loadTypeScript("lib/routing/mapboxTerrainElevation.ts");
    global.fetch = async () => new Response("provider failed", {status});
    const value = await provider.getValidatedCumulativePositiveElevationGain(elevationGeometry, 0.31);
    assert.strictEqual(value.status, "unavailable");
    assert.strictEqual(value.cumulativePositiveElevationGainM, null);
    assert.strictEqual(value.validationReason, `elevation_provider_http_${status}`);
    global.fetch = async () => new Response(png);
    assert.strictEqual((await provider.getValidatedCumulativePositiveElevationGain(elevationGeometry, 0.31)).status, "validated", "Failed requests are not cached");
  }
  for (const badTile of [Buffer.from("not png"), png.subarray(0,64), await sharp({create:{width:2,height:2,channels:3,background:"white"}}).png().toBuffer()]) {
    global.fetch = async () => new Response(badTile);
    const value = await loadTypeScript("lib/routing/mapboxTerrainElevation.ts").getValidatedCumulativePositiveElevationGain(elevationGeometry, 0.31);
    assert.strictEqual(value.status, "unavailable");
    assert.strictEqual(value.cumulativePositiveElevationGainM, null);
  }
  for (let i = 3; i < raw.length; i += 4) raw[i] = 0;
  const transparent = await sharp(raw, {raw:{width:512,height:512,channels:4}}).png().toBuffer();
  global.fetch = async () => new Response(transparent);
  assert.strictEqual((await loadTypeScript("lib/routing/mapboxTerrainElevation.ts").getValidatedCumulativePositiveElevationGain(elevationGeometry, 0.31)).status, "invalid");
  global.fetch = async () => { throw new DOMException("test timeout", "TimeoutError"); };
  assert.strictEqual((await loadTypeScript("lib/routing/mapboxTerrainElevation.ts").getValidatedCumulativePositiveElevationGain(elevationGeometry, 0.31)).validationReason, "elevation_provider_timeout");
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  tokenNames.forEach((name, i) => {
    if (previousTokens[i] === undefined) delete process.env[name];
    else process.env[name] = previousTokens[i];
  });
  global.fetch = previousFetch;
}

const pickupFeeCompatibility = fare.computeShortTripAutomaticFare({
  roadDistanceKm: 1,
  validatedCumulativePositiveElevationGainM: 25,
  pickupDistanceFee: 10,
});
assert.strictEqual(pickupFeeCompatibility.automaticRideFare, 25);
assert.strictEqual(pickupFeeCompatibility.convenienceFee, 15);
assert.strictEqual(pickupFeeCompatibility.total, 50);

let evaluatedRoadKm = 3;
let elevationCalls = 0;
const pilot = loadTypeScript("lib/shortTripAutomaticPilot.ts", {
  "@/lib/pricing/pickupFee": loadTypeScript("lib/pricing/pickupFee.ts"),
  "@/lib/location/coordinateValidity": loadTypeScript("lib/location/coordinateValidity.ts"),
  "@/lib/shortTripAutomaticFare": fare,
  "@/lib/routing/mapboxRoad": {
    getDrivingRoadRouteWithGeometry: async () => ({ distanceKm: evaluatedRoadKm, geometry: elevationGeometry }),
    getDrivingRoadRoute: async () => ({ distanceKm: 0.5, durationSeconds: 60 }),
  },
  "@/lib/routing/mapboxTerrainElevation": {
    ...elevation,
    getValidatedCumulativePositiveElevationGain: async () => {
      elevationCalls++;
      return elevation.validateElevationValues([100,125,150,175], 4, evaluatedRoadKm);
    },
  },
});
const pilotQuery = {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{lat:16,lng:121}})};
const pilotArgs = {booking:{service_type:"motorcycle",pickup_lat:16,pickup_lng:121,dropoff_lat:16.002,dropoff_lng:121.002},driverId:"driver-1",supabase:{from:()=>pilotQuery}};
const evaluatedFare = await pilot.evaluateShortTripAutomaticFare(pilotArgs);
assert.strictEqual(evaluatedFare.outcome,"automatic");
assert.strictEqual(evaluatedFare.fare.automaticRideFare,65);
assert.strictEqual(evaluatedFare.fare.total,80);
assert.strictEqual(evaluatedFare.snapshot.elevation_version,elevation.MAPBOX_ELEVATION_VERSION);
assert.strictEqual(evaluatedFare.snapshot.rounding_version,fare.SHORT_TRIP_FARE_ROUNDING_VERSION);
assert.strictEqual(evaluatedFare.snapshot.ride_fare_before_rounding,evaluatedFare.fare.rideFareBeforeRounding);
assert.strictEqual(evaluatedFare.snapshot.ride_fare_rounding_adjustment,evaluatedFare.fare.rideFareRoundingAdjustment);
assert.strictEqual(evaluatedFare.snapshot.validated_cumulative_positive_elevation_gain_m,75);
assert.strictEqual(evaluatedFare.snapshot.free_elevation_allowance_m,25);
assert.strictEqual(evaluatedFare.snapshot.chargeable_elevation_gain_m,50);
assert.strictEqual(evaluatedFare.snapshot.distance_component,60);
assert.strictEqual(evaluatedFare.snapshot.elevation_premium,5);
assert.strictEqual(evaluatedFare.snapshot.minimum_applied,false);
assert.strictEqual(evaluatedFare.snapshot.convenience_fee,15);
evaluatedRoadKm=3.000001;
assert.strictEqual((await pilot.evaluateShortTripAutomaticFare(pilotArgs)).fallbackReason,"road_distance_above_short_trip_limit");
assert.strictEqual(elevationCalls,1,"Long rides do not request terrain");
assert.strictEqual((await pilot.evaluateShortTripAutomaticFare({...pilotArgs,booking:{...pilotArgs.booking,service_type:"errand"}})).fallbackReason,"service_type_not_regular_ride");

const persistedPilot = loadDispatchStatusRoute({evaluation:evaluatedFare});
assert.strictEqual((await callDispatchStatus(persistedPilot.route,{booking_code:"RIDE-1",status:"accepted"})).status,200);
assert.deepStrictEqual(persistedPilot.supabase.calls.updates[0].short_trip_fare_evaluation,evaluatedFare.snapshot);
assert.strictEqual(persistedPilot.supabase.calls.rpcs[0].args.p_meta.elevation_version,elevation.MAPBOX_ELEVATION_VERSION);

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
assert.strictEqual(automaticUpdate.ride_fare_provenance, elevation.MAPBOX_FARE_PROVENANCE);
assert.strictEqual(automaticUpdate.short_trip_elevation_source, elevation.MAPBOX_ELEVATION_SOURCE);
assert.strictEqual(automaticRoute.supabase.calls.rpcs[0].args.p_meta.provenance, elevation.MAPBOX_FARE_PROVENANCE);

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
assert.strictEqual(fallbackResponse.status, 503);
assert.strictEqual(fallbackResponse.body.code, "AUTOMATIC_FARE_UNAVAILABLE");
assert.strictEqual(fallbackRoute.supabase.calls.updates.length, 0);
assert.strictEqual(fallbackRoute.supabase.calls.rpcs.length, 0);

const longRoute = loadDispatchStatusRoute({evaluation:{...fallbackConfig.evaluation, roadDistanceKm:3.000001, fallbackReason:"road_distance_above_short_trip_limit"}});
assert.strictEqual((await callDispatchStatus(longRoute.route, {booking_code:"RIDE-1", status:"accepted"})).status, 200);
const fallbackUpdate = longRoute.supabase.calls.updates[0];
assert.strictEqual(fallbackUpdate.status, "accepted");
assert.strictEqual(fallbackUpdate.driver_accept_expires_at, null);
assert.ok(Date.parse(fallbackUpdate.driver_fee_proposal_expires_at) > Date.now());
assert.strictEqual(fallbackUpdate.ride_fare_mode, null);
assert.strictEqual(fallbackUpdate.short_trip_elevation_status, "unavailable");
assert.strictEqual(longRoute.supabase.calls.rpcs.length, 0);

const savedNow = Date.now;
const initialNow = savedNow();
try {
  Date.now = () => initialNow;
  const expiredDuringFetch = loadDispatchStatusRoute({evaluation:makeAutomaticEvaluation(),onEvaluate:() => {Date.now = () => initialNow + 120000;}});
  assert.strictEqual((await callDispatchStatus(expiredDuringFetch.route, {booking_code:"RIDE-1",status:"accepted"})).status, 409);
  assert.strictEqual(expiredDuringFetch.supabase.calls.updates.length, 0);
} finally { Date.now = savedNow; }

const retryConfig = {evaluation:fallbackConfig.evaluation};
const retryRoute = loadDispatchStatusRoute(retryConfig);
assert.strictEqual((await callDispatchStatus(retryRoute.route,{booking_code:"RIDE-1",status:"accepted"})).status,503);
retryConfig.evaluation = makeAutomaticEvaluation();
assert.strictEqual((await callDispatchStatus(retryRoute.route,{booking_code:"RIDE-1",status:"accepted"})).status,200);
assert.strictEqual(retryRoute.supabase.calls.updates.length,1);
assert.strictEqual(retryRoute.supabase.calls.updates[0].status,"ready");

for (const evaluationConfig of [
  {evaluation:{...fallbackConfig.evaluation,roadDistanceKm:null,fallbackReason:"trip_road_route_unavailable"}},
  {evaluationError:new Error("test provider failure")},
]) {
  const unavailableRoute=loadDispatchStatusRoute(evaluationConfig);
  assert.strictEqual((await callDispatchStatus(unavailableRoute.route,{booking_code:"RIDE-1",status:"accepted"})).status,503);
  assert.strictEqual(unavailableRoute.supabase.calls.updates.length,0);
}

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

// Exercise the actual private completion-receipt reader with a read-only DB
// fixture. Receipt failures must never manufacture zero deductions or change
// a completed ride's settlement.
const receiptSource = dispatchStatus.slice(dispatchStatus.indexOf("async function readRideCompletionReceipt("), dispatchStatus.indexOf("export async function POST("));
const receiptJs = ts.transpileModule(receiptSource, {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const receiptReader = new Function("isRegularRideServiceType", "clean", receiptJs + "\nreturn readRideCompletionReceipt;")(fare.isRegularRideServiceType, value => String(value ?? "").trim());
async function readReceipt(changes = {}) {
  const filters = [];
  const row = {id:"booking-1",status:"completed",driver_id:"driver-1",verified_fare:30,pickup_distance_fee:100,promo_applied_amount:0,wallet_settlement_status:"settled",wallet_settlement_id:"settlement-1",...(changes.row || {})};
  const entries = changes.entries || [{amount:-15,reason:"ride_platform_cut_15"}];
  const db = {from(table) {
    const answer = {data:table === "bookings" ? row : entries,error:changes.error || null};
    return {select(){return this;},eq(column,value){filters.push({table,column,value});return this;},maybeSingle:async()=>answer,then(resolve,reject){return Promise.resolve(answer).then(resolve,reject);}};
  }};
  const result = await receiptReader(db,{id:"booking-1",service_type:changes.service || "tricycle",driver_id:"driver-1"});
  return {result,filters};
}
const receipt = await readReceipt();
assert.strictEqual(receipt.result.customer_total,145);
assert.strictEqual(receipt.result.wallet_deduction,15);
assert.strictEqual(receipt.result.cash_after_wallet_deduction,130);
assert.ok(receipt.filters.some(x=>x.table==="driver_wallet_transactions" && x.column==="driver_id" && x.value==="driver-1"));
assert.ok(receipt.filters.some(x=>x.column==="wallet_settlement_id" && x.value==="settlement-1"));
assert.strictEqual((await readReceipt({row:{verified_fare:29.75}})).result.customer_total,144.75,"Historical fare cents are preserved");
assert.strictEqual((await readReceipt({row:{promo_applied_amount:40}})).result.customer_total,105);
assert.strictEqual((await readReceipt({row:{promo_applied_amount:145}})).result.cash_after_wallet_deduction,-15,"A fully discounted cash trip is not represented as positive cash earnings");
for (const changes of [
  {row:{driver_id:"another-driver"}}, {row:{status:"on_trip"}},
  {row:{wallet_settlement_status:"pending"}}, {row:{wallet_settlement_id:null}},
  {row:{verified_fare:null}}, {row:{pickup_distance_fee:null}},
  {row:{verified_fare:"NaN"}}, {entries:[]}, {entries:[{amount:15,reason:"ride_platform_cut_15"}]},
  {entries:[{amount:-15,reason:"unknown"}]}, {entries:[{amount:-15,reason:"ride_platform_cut_15"},{amount:-15,reason:"ride_platform_cut_15"}]},
  {error:{message:"fixture failure"}}, {service:"errand"}
]) assert.strictEqual((await readReceipt(changes)).result,null);
console.log("PASS recorded completion receipt: ownership, ledger scope, promo, legacy cents, missing data");
console.log("short-trip-automatic-fare: ok");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
