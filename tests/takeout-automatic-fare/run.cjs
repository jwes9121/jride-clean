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
    const { helper, db } = makeHarness({ deliveryKm: 2, pickupKm: 6.5 });
    const result = await helper.evaluateTakeoutAutomaticDeliveryFare({
      booking: booking(500.01),
      driverId: "driver-1",
      supabase: db,
    });
    assert.equal(result.outcome, "automatic");
    assert.equal(result.pickupBreakdown.pickup_first_tier_fee, 200);
    assert.equal(result.pickupBreakdown.pickup_beyond_first_tier_fee, 0);
    assert.equal(result.pickupBreakdown.pickup_excess_fee, 200);
    assert.equal(result.pickupBreakdown.pickup_distance_exception_required, false);
  }

  {
    const { helper, db } = makeHarness({ deliveryKm: 2, pickupKm: 10 });
    const result = await helper.evaluateTakeoutAutomaticDeliveryFare({
      booking: booking(500.01),
      driverId: "driver-1",
      supabase: db,
    });
    assert.equal(result.outcome, "automatic");
    assert.equal(result.pickupBreakdown.pickup_first_tier_fee, 200);
    assert.equal(result.pickupBreakdown.pickup_beyond_first_tier_fee, 70);
    assert.equal(result.pickupBreakdown.pickup_excess_fee, 270);
    assert.equal(result.pickupBreakdown.pickup_beyond_first_tier_units_500m, 7);
    assert.equal(result.pickupBreakdown.pickup_distance_exception_required, false);
  }

  {
    const { helper, db } = makeHarness({ deliveryKm: 2, pickupKm: 12.19 });
    const result = await helper.evaluateTakeoutAutomaticDeliveryFare({
      booking: booking(500.01),
      driverId: "driver-1",
      supabase: db,
    });
    assert.equal(result.outcome, "automatic");
    assert.equal(result.pickupBreakdown.pickup_distance_km, 12.19);
    assert.equal(result.pickupBreakdown.pickup_priced_distance_km, 10);
    assert.equal(result.pickupBreakdown.pickup_excess_fee, 270);
    assert.equal(result.pickupBreakdown.pickup_distance_exception_required, true);
    assert.equal(result.snapshot.takeout_pickup_distance_exception_required, true);
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
  assert.match(proposal, /const MIN_DELIVERY_FEE = 25;/);
  assert.match(proposal, /deliveryFee < MIN_DELIVERY_FEE/);
  assert.match(proposal, /Takeout delivery fee must be at least PHP 25\./);
  assert.match(proposal, /CUSTOMER_CASH_PICKUP_FIRST_TIER_END_KM = 6\.5/);
  assert.match(proposal, /CUSTOMER_CASH_PICKUP_SECOND_TIER_END_KM = 10/);
  assert.match(proposal, /CUSTOMER_CASH_PICKUP_SECOND_TIER_RATE_PER_500M = 10/);
  assert.match(proposal, /CUSTOMER_CASH_PICKUP_FIRST_TIER_MAX_FEE = 200/);
  assert.match(proposal, /CUSTOMER_CASH_PICKUP_SECOND_TIER_MAX_FEE = 70/);
  assert.match(proposal, /pickup_distance_exception_required/);
  assert.match(proposal, /handleTakeoutPickupDistanceException/);
  assert.match(proposal, /TAKEOUT_PICKUP_DISTANCE_EXCEPTION/);
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
  assert.match(status, /handleTakeoutPickupDistanceException/);
  assert.match(status, /TAKEOUT_PICKUP_DISTANCE_EXCEPTION/);
  assert.match(status, /takeout_split_cash_v2/);
  assert.match(status, /strictCashSplitClient &&\\n\\s*expectedFinal != null/);
  assert.doesNotMatch(status, /\\(strictCashSplitClient \\|\\| cashCollectedAmount != null\\)/);
  assert.match(status, /TAKEOUT_CASH_FIRST_AMOUNT_MISMATCH/);
  assert.match(status, /TAKEOUT_FINAL_PAYMENT_AMOUNT_MISMATCH/);
  assert.match(status, /takeout_cash_first_collected_amount/);
  assert.match(status, /takeout_final_collected_amount/);

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

  const splitCashMigration = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260927100000_takeout_split_cash_accounting_v1.sql"
    ),
    "utf8"
  );
  assert.match(splitCashMigration, /takeout_product_purchase_amount/);
  assert.match(splitCashMigration, /takeout_cash_first_amount/);
  assert.match(splitCashMigration, /takeout_pay_on_delivery_amount/);
  assert.match(splitCashMigration, /takeout_driver_commission/);
  assert.match(splitCashMigration, /takeout_company_revenue/);
  assert.match(splitCashMigration, /takeout_driver_delivery_earnings/);
  assert.match(splitCashMigration, /v_cash_required := v_items > 500/);
  assert.match(splitCashMigration, /greatest\(coalesce\(new\.pickup_distance_fee, 0\), 0\)/);
  assert.match(splitCashMigration, /takeout_pickup_excess_fee/);
  assert.match(splitCashMigration, /v_commission := case when v_delivery >= 50 then 5 else 0 end/);
  assert.match(splitCashMigration, /v_company := round\(v_service \+ v_commission, 2\)/);
  assert.match(splitCashMigration, /v_driver_earnings := greatest\(round\(v_delivery \+ v_pickup - v_commission, 2\), 0\)/);

  const cashAuditMigration = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260927184500_takeout_cash_collection_audit_v1.sql"
    ),
    "utf8"
  );
  assert.match(cashAuditMigration, /takeout_cash_first_collected_amount/);
  assert.match(cashAuditMigration, /takeout_cash_first_collected_at/);
  assert.match(cashAuditMigration, /takeout_final_collected_amount/);
  assert.match(cashAuditMigration, /takeout_final_collected_at/);

  const pickupExceptionHelper = fs.readFileSync(
    path.join(root, "lib/takeoutPickupDistanceException.ts"),
    "utf8"
  );
  assert.match(pickupExceptionHelper, /pickup_distance_over_10km/);
  assert.match(pickupExceptionHelper, /triggerTakeoutFeeProposalReassign/);
  assert.match(pickupExceptionHelper, /openTakeoutDriverUnavailableOperationsCase/);
  assert.match(pickupExceptionHelper, /takeout_pickup_distance_exception_status/);

  const takeoutDispatch = fs.readFileSync(
    path.join(root, "app/api/admin/takeout-dispatch/route.ts"),
    "utf8"
  );
  assert.match(takeoutDispatch, /pickup_distance_exception_required/);
  assert.match(takeoutDispatch, /pickup_distance_exception_status/);
  assert.match(splitCashMigration, /wallet_settlement_status = 'settled'/);

  const takeoutPage = fs.readFileSync(
    path.join(root, "app/takeout/page.tsx"),
    "utf8"
  );
  assert.match(takeoutPage, /const cashCollectionRequired = itemsSubtotal > 500;/);
  assert.doesNotMatch(takeoutPage, /estimatedSubtotalWithPackaging >= 500/);
  assert.match(takeoutPage, /Give driver now for vendor purchase/);
  assert.match(takeoutPage, /Pay on final delivery/);

  const driverActive = fs.readFileSync(
    path.join(root, "app/api/driver/active-trip/route.ts"),
    "utf8"
  );
  assert.match(driverActive, /cash_collection_amount/);
  assert.match(driverActive, /pay_on_delivery_amount/);
  assert.match(driverActive, /for the vendor purchase only/);

  console.log("takeout-automatic-fare: ok");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
