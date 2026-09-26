const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");

function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const source = fs.readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: (name) => mocks[name] || require(name),
      Date,
      console,
      process,
      setTimeout,
      clearTimeout,
    },
    { filename }
  );
  return module.exports;
}

const rideFare = load("lib/shortTripAutomaticFare.ts");

function makeHarness(config = {}) {
  const calls = {
    deliveryRoutes: [],
    pickupRoutes: [],
    elevation: 0,
  };

  const coordinateValidity = {
    parseUsableCoordinatePair(lat, lng) {
      const a = Number(lat);
      const b = Number(lng);
      if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) {
        return null;
      }
      return { lat: a, lng: b };
    },
  };

  const mapboxRoad = {
    async getDrivingRoadRouteWithGeometry(from, to) {
      calls.deliveryRoutes.push({ from, to });
      if (config.deliveryUnavailable) return null;
      return {
        distanceKm: config.deliveryKm ?? 3,
        durationSeconds: 300,
        geometry: { type: "LineString", coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
      };
    },
    async getDrivingRoadRoute(from, to) {
      calls.pickupRoutes.push({ from, to });
      if (config.pickupUnavailable) return null;
      return {
        distanceKm: config.pickupKm ?? 2,
        durationSeconds: 180,
      };
    },
  };

  const elevation = {
    MAPBOX_ELEVATION_SOURCE: "mapbox_terrain_rgb_v1",
    MAPBOX_ELEVATION_VERSION: "mapbox_terrain_elevation_v1",
    MAPBOX_FARE_PROVENANCE: "mapbox_road_terrain_rgb_v1",
    async getValidatedCumulativePositiveElevationGain() {
      calls.elevation += 1;
      if (config.elevationUnavailable) {
        return {
          status: "unavailable",
          source: "mapbox_terrain_rgb_v1",
          version: "mapbox_terrain_elevation_v1",
          cumulativePositiveElevationGainM: null,
          samplesRequested: 3,
          samplesUsed: 0,
          filteredOutlierCount: 0,
          validationReason: "test_unavailable",
        };
      }
      return {
        status: "validated",
        source: "mapbox_terrain_rgb_v1",
        version: "mapbox_terrain_elevation_v1",
        cumulativePositiveElevationGainM: config.elevationGainM ?? 25,
        samplesRequested: 3,
        samplesUsed: 3,
        filteredOutlierCount: 0,
        validationReason: null,
      };
    },
  };

  const helper = load("lib/takeoutAutomaticDeliveryFare.ts", {
    "@/lib/location/coordinateValidity": coordinateValidity,
    "@/lib/routing/mapboxRoad": mapboxRoad,
    "@/lib/routing/mapboxTerrainElevation": elevation,
    "@/lib/shortTripAutomaticFare": rideFare,
  });

  const driverRow = {
    driver_id: "driver-1",
    lat: config.driverLat ?? 16.9,
    lng: config.driverLng ?? 121.05,
    status: config.driverStatus ?? "online",
    updated_at: config.driverUpdatedAt ?? new Date().toISOString(),
  };

  const db = {
    from(table) {
      assert.equal(table, "driver_locations");
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          return config.noDriverLocation
            ? { data: null, error: null }
            : { data: driverRow, error: null };
        },
      };
    },
  };

  return { helper, db, calls };
}

function booking(subtotal) {
  return {
    id: "booking-1",
    booking_code: "TO-TEST",
    service_type: "takeout",
    takeout_items_subtotal: subtotal,
    pickup_lat: 16.919828,
    pickup_lng: 121.060421,
    dropoff_lat: 16.895109,
    dropoff_lng: 121.058457,
    takeout_pricing_snapshot: {},
  };
}

(async () => {
  {
    const { helper, db } = makeHarness({ deliveryKm: 0.1, elevationGainM: 0 });
    const result = await helper.evaluateTakeoutAutomaticDeliveryFare({
      booking: booking(90),
      driverId: "driver-1",
      supabase: db,
    });
    assert.equal(result.outcome, "automatic");
    assert.equal(result.deliveryFee, 25);
    assert.equal(result.serviceFee, 15);
    assert.equal(result.totalPayable, 130);
    assert.equal(result.fare.rideMinimumApplied, true);
  }

  {
    const { helper, db, calls } = makeHarness({ deliveryKm: 3, elevationGainM: 25 });
    const result = await helper.evaluateTakeoutAutomaticDeliveryFare({
      booking: booking(340),
      driverId: "driver-1",
      supabase: db,
    });
    assert.equal(result.outcome, "automatic");
    assert.equal(result.routePlan, "vendor_first");
    assert.equal(result.cashRequired, false);
    assert.equal(result.deliveryFee, 60);
    assert.equal(result.serviceFee, 15);
    assert.equal(result.totalPayable, 415);
    assert.equal(result.pickupBreakdown.pickup_excess_fee, 0);
    assert.equal(calls.pickupRoutes.length, 0);
    assert.equal(result.snapshot.version, "takeout_short_trip_automatic_v1");
    assert.equal(result.snapshot.vendor_to_customer_road_distance_km, 3);
  }

  {
    const { helper, db } = makeHarness({ deliveryKm: 1 });
    const result = await helper.evaluateTakeoutAutomaticDeliveryFare({
      booking: booking(500),
      driverId: "driver-1",
      supabase: db,
    });
    assert.equal(result.outcome, "automatic");
    assert.equal(result.routePlan, "vendor_first");
    assert.equal(result.cashRequired, false);
  }

  {
    const { helper, db, calls } = makeHarness({ deliveryKm: 2, pickupKm: 2 });
    const row = booking(500.01);
    const result = await helper.evaluateTakeoutAutomaticDeliveryFare({
      booking: row,
      driverId: "driver-1",
      supabase: db,
    });
    assert.equal(result.outcome, "automatic");
    assert.equal(result.routePlan, "customer_cash_first");
    assert.equal(result.cashRequired, true);
    assert.equal(result.deliveryFee, 40);
    assert.equal(result.pickupBreakdown.pickup_excess_fee, 20);
    assert.equal(result.totalPayable, 575.01);
    assert.equal(calls.pickupRoutes.length, 1);
    assert.equal(calls.pickupRoutes[0].to.lat, row.dropoff_lat);
    assert.equal(calls.pickupRoutes[0].to.lng, row.dropoff_lng);
  }

  {
    const { helper, db, calls } = makeHarness({ deliveryKm: 3.000001 });
    const result = await helper.evaluateTakeoutAutomaticDeliveryFare({
      booking: booking(340),
      driverId: "driver-1",
      supabase: db,
    });
    assert.equal(result.outcome, "manual");
    assert.equal(result.reason, "road_distance_above_short_trip_limit");
    assert.equal(calls.elevation, 0);
  }

  {
    const { helper, db } = makeHarness({
      deliveryKm: 2,
      elevationUnavailable: true,
    });
    const result = await helper.evaluateTakeoutAutomaticDeliveryFare({
      booking: booking(340),
      driverId: "driver-1",
      supabase: db,
    });
    assert.equal(result.outcome, "retry");
    assert.equal(result.reason, "takeout_delivery_elevation_unavailable");
  }

  const proposal = fs.readFileSync(
    path.join(root, "app/api/driver/takeout-fee/propose/route.ts"),
    "utf8"
  );
  assert.match(proposal, /const cashRequired = computedSubtotal > 500;/);
  assert.doesNotMatch(proposal, /computedSubtotal >= 500/);
  assert.match(proposal, /const passengerLat = num\(order\.dropoff_lat\);/);
  assert.match(proposal, /const passengerLng = num\(order\.dropoff_lng\);/);

  const requests = fs.readFileSync(
    path.join(root, "app/api/driver/takeout-fee/requests/route.ts"),
    "utf8"
  );
  assert.match(requests, /\(foodSubtotal \?\? 0\) > 500/);
  assert.doesNotMatch(requests, /\(foodSubtotal \?\? 0\) >= 500/);

  const dispatch = fs.readFileSync(
    path.join(root, "app/api/admin/takeout-dispatch/route.ts"),
    "utf8"
  );
  assert.match(dispatch, /cash_required: subtotal > 500/);
  assert.doesNotMatch(dispatch, /cash_required: subtotal >= 500/);

  const vendor = fs.readFileSync(
    path.join(root, "app/api/vendor-orders/route.ts"),
    "utf8"
  );
  assert.match(vendor, /const cashFirst = subtotal > 500;/);

  const status = fs.readFileSync(
    path.join(root, "app/api/driver/takeout-status/route.ts"),
    "utf8"
  );
  assert.match(status, /evaluateTakeoutAutomaticDeliveryFare/);
  assert.match(status, /confirm_takeout_automatic_short_trip_v1/);
  assert.match(status, /automaticTakeoutFare\?\.outcome === "automatic"/);
  assert.match(status, /TAKEOUT_AUTOMATIC_FARE_UNAVAILABLE/);

  const vendorOrdersRoute = fs.readFileSync(
    path.join(root, "app/api/vendor-orders/route.ts"),
    "utf8"
  );
  assert.match(vendorOrdersRoute, /TAKEOUT_ACTIVE_ORDER_EXISTS/);
  assert.match(vendorOrdersRoute, /created_by_user_id/);
  assert.match(vendorOrdersRoute, /\.not\("status", "in", "\(completed,cancelled,canceled\)"\)/);
  assert.match(vendorOrdersRoute, /ux_bookings_one_active_takeout_passenger_v1/);
  assert.match(status, /TAKEOUT_VENDOR_NOT_READY_FOR_PICKUP/);
  assert.match(status, /TAKEOUT_DRIVER_NOT_AT_VENDOR/);
  assert.match(status, /vendor_driver_arrived_at/);
  assert.match(status, /vendor_order_picked_at/);
  assert.match(status, /nextStatus === "picked_up"/);
  assert.match(status, /driverWorkflowStatus !== "rider_arrived_vendor"/);

  const migration = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260926103000_takeout_short_trip_automatic_fare_v1.sql"
    ),
    "utf8"
  );
  assert.match(
    migration,
    /coalesce\(booking_row\.takeout_items_subtotal, 0\) > 500/
  );
  assert.match(migration, /from public\.takeout_order_items/);
  assert.match(migration, /update public\.vendor_menu_items as menu/);
  assert.match(migration, /takeout_customer_confirmed_at = effective_now/);
  assert.match(migration, /driver_fee_proposal_expires_at = null/);

  const singleActiveMigration = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260926121500_takeout_single_active_order_v1.sql"
    ),
    "utf8"
  );
  assert.match(
    singleActiveMigration,
    /create unique index if not exists ux_bookings_one_active_takeout_passenger_v1/
  );
  assert.match(singleActiveMigration, /service_type = 'takeout'/);
  assert.match(
    singleActiveMigration,
    /status not in \('completed', 'cancelled', 'canceled'\)/
  );

  console.log("takeout-automatic-fare: ok");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
