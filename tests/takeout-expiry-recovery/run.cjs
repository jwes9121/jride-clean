const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');

function load(file) {
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync(path.join(root, file), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;

  vm.runInNewContext(
    code,
    { module, exports: module.exports, require, Date, console },
    { filename: file },
  );
  return module.exports;
}

function makeDb(initialRow) {
  const row = { ...initialRow };
  const rpcCalls = [];
  const notifications = [];
  let writes = 0;

  return {
    row,
    rpcCalls,
    notifications,
    get writes() {
      return writes;
    },
    from(table) {
      if (table === 'driver_notifications') {
        return {
          async insert(value) {
            notifications.push({ ...value });
            return { data: null, error: null };
          },
        };
      }

      assert.equal(table, 'bookings');
      let patch = null;
      const checks = [];

      const query = {
        update(value) {
          patch = value;
          return query;
        },
        eq(key, value) {
          checks.push((candidate) => String(candidate[key]) === String(value));
          return query;
        },
        in(key, values) {
          checks.push((candidate) => values.includes(candidate[key]));
          return query;
        },
        is(key, value) {
          checks.push((candidate) => candidate[key] == value);
          return query;
        },
        not(key, operator, value) {
          assert.equal(operator, 'is');
          assert.equal(value, null);
          checks.push((candidate) => candidate[key] != null);
          return query;
        },
        lte(key, value) {
          checks.push(
            (candidate) => Date.parse(candidate[key]) <= Date.parse(value),
          );
          return query;
        },
        select() {
          return query;
        },
        async limit() {
          if (!checks.every((check) => check(row))) {
            return { data: [], error: null };
          }
          assert(patch, 'update patch is required');
          writes += 1;
          Object.assign(row, patch);
          return {
            data: [{ id: row.id, booking_code: row.booking_code }],
            error: null,
          };
        },
      };

      return query;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  };
}

const timeout = load('lib/takeout-passenger-fare-timeout.ts');
const recovery = load('lib/takeout-expiry-recovery.ts');
const expiredAt = '2020-01-01T00:00:00.000Z';
const proposedAt = '2019-12-31T23:55:00.000Z';

function booking(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    booking_code: 'TO-TIMEOUT-TEST',
    service_type: 'takeout',
    status: 'accepted',
    vendor_status: 'driver_accepted',
    customer_status: 'driver_accepted',
    driver_status: 'accepted',
    assigned_driver_id: '22222222-2222-4222-8222-222222222222',
    driver_id: '22222222-2222-4222-8222-222222222222',
    takeout_customer_confirmed_at: null,
    takeout_fee_proposed_at: proposedAt,
    takeout_delivery_fee: 90,
    takeout_fee_expires_at: expiredAt,
    driver_fee_proposal_expires_at: expiredAt,
    takeout_fee_proposed_by_driver_id:
      '22222222-2222-4222-8222-222222222222',
    takeout_pricing_status: 'driver_fee_proposed',
    ...overrides,
  };
}

function cancelParams(row, overrides = {}) {
  return {
    bookingId: row.id,
    bookingCode: row.booking_code,
    expiredDriverId: row.assigned_driver_id,
    expectedTakeoutFeeProposedAt: proposedAt,
    expectedTakeoutFeeExpiresAt: expiredAt,
    expectedDriverFeeProposalExpiresAt: expiredAt,
    ...overrides,
  };
}

(async () => {
  let passed = 0;
  async function test(name, fn) {
    await fn();
    passed += 1;
    console.log('PASS: ' + name);
  }

  await test('expired unconfirmed TakeOut proposal cancels once and preserves quote audit fields', async () => {
    const db = makeDb(booking());
    const result = await timeout.cancelExpiredTakeoutPassengerFareConfirmation(
      db,
      cancelParams(db.row),
    );

    assert.equal(result.didCancel, true);
    assert.equal(db.writes, 1);
    assert.equal(db.row.status, 'cancelled');
    assert.equal(db.row.vendor_status, 'cancelled');
    assert.equal(db.row.customer_status, 'cancelled');
    assert.equal(db.row.driver_status, 'cancelled');
    assert.equal(db.row.assigned_driver_id, null);
    assert.equal(db.row.driver_id, null);
    assert.equal(
      db.row.cancel_reason,
      'Booking cancelled because the proposed fare was not confirmed within 5 minutes. Please book again.',
    );
    assert.equal(db.row.takeout_pricing_status, 'expired');
    assert.equal(db.row.takeout_fee_proposed_at, proposedAt);
    assert.equal(db.row.takeout_fee_expires_at, expiredAt);
    assert.equal(db.row.driver_fee_proposal_expires_at, expiredAt);
    assert.equal(db.row.takeout_delivery_fee, 90);
    assert.equal(
      db.row.takeout_fee_proposed_by_driver_id,
      '22222222-2222-4222-8222-222222222222',
    );
  });

  await test('confirmed, unexpired, terminal, or different-driver rows are not cancelled', async () => {
    const cases = [
      booking({ takeout_customer_confirmed_at: '2020-01-01T00:00:01.000Z' }),
      booking({
        takeout_fee_expires_at: '2999-01-01T00:00:00.000Z',
        driver_fee_proposal_expires_at: '2999-01-01T00:00:00.000Z',
      }),
      booking({ status: 'cancelled' }),
      booking({ status: 'completed' }),
    ];

    for (const row of cases) {
      const db = makeDb(row);
      const result = await timeout.cancelExpiredTakeoutPassengerFareConfirmation(
        db,
        cancelParams(db.row),
      );
      assert.equal(result.didCancel, false);
      assert.equal(db.writes, 0);
    }

    const differentDriver = makeDb(booking());
    const result = await timeout.cancelExpiredTakeoutPassengerFareConfirmation(
      differentDriver,
      cancelParams(differentDriver.row, {
        expiredDriverId: '33333333-3333-4333-8333-333333333333',
      }),
    );
    assert.equal(result.didCancel, false);
    assert.equal(differentDriver.writes, 0);
  });

  await test('stale sweep cannot cancel a replacement proposal for the same booking', async () => {
    const replacementProposedAt = '2020-01-01T00:01:00.000Z';
    const replacementExpiresAt = '2020-01-01T00:06:00.000Z';
    const db = makeDb(
      booking({
        takeout_fee_proposed_at: replacementProposedAt,
        takeout_fee_expires_at: replacementExpiresAt,
        driver_fee_proposal_expires_at: replacementExpiresAt,
      }),
    );

    const result = await timeout.cancelExpiredTakeoutPassengerFareConfirmation(
      db,
      cancelParams(db.row),
    );

    assert.equal(result.didCancel, false);
    assert.equal(db.writes, 0);
    assert.equal(db.row.takeout_fee_proposed_at, replacementProposedAt);
    assert.equal(db.row.status, 'accepted');
  });

  await test('expired pricing marker remains cancellable but only for the exact proposal', async () => {
    const db = makeDb(booking({ takeout_pricing_status: 'expired' }));
    const result = await timeout.cancelExpiredTakeoutPassengerFareConfirmation(
      db,
      cancelParams(db.row),
    );
    assert.equal(result.didCancel, true);
    assert.equal(db.writes, 1);
  });

  await test('driver receives a timeout notification only after cancellation path calls notifier', async () => {
    const db = makeDb(booking());
    const result = await timeout.notifyTakeoutFareTimeoutDriver(db, {
      expiredDriverId: db.row.assigned_driver_id,
      bookingCode: db.row.booking_code,
    });

    assert.equal(result.sent, true);
    assert.equal(result.error, null);
    assert.equal(db.notifications.length, 1);
    assert.equal(db.notifications[0].driver_id, db.row.assigned_driver_id);
    assert.equal(db.notifications[0].type, 'fare_confirmation_timeout');
    assert.match(db.notifications[0].message, /cancelled/);
    assert.match(db.notifications[0].message, /5 minutes/);
  });

  await test('lifecycle audit identifies passenger timeout and explicitly forbids reassignment penalty', async () => {
    const db = makeDb(booking());
    await timeout.recordTakeoutPassengerFareTimeoutLifecycleEvent(db, {
      bookingId: db.row.id,
      bookingCode: db.row.booking_code,
      passengerId: '44444444-4444-4444-8444-444444444444',
      expiredDriverId: db.row.assigned_driver_id,
      townRaw: 'Lagawe',
      statusBefore: 'accepted',
      expiresAt: expiredAt,
    });

    assert.equal(db.rpcCalls.length, 1);
    const call = db.rpcCalls[0];
    assert.equal(call.name, 'record_booking_lifecycle_event');
    assert.equal(call.args.p_event_type, 'fare_response_expired');
    assert.equal(call.args.p_status_after, 'cancelled');
    assert.equal(call.args.p_source, 'system_cron');
    assert.equal(call.args.p_meta.reason, 'passenger_fare_confirmation_timeout');
    assert.equal(call.args.p_meta.timeout_owner, 'passenger');
    assert.equal(call.args.p_meta.driver_penalty, false);
    assert.equal(call.args.p_meta.reassign, false);
  });

  await test('Takeout driver offer cap counts two different expired drivers but not the same driver twice', () => {
    const driverA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const driverB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    assert.equal(
      recovery.reachedTakeoutUniqueDriverOfferLimit(null, driverA),
      false,
    );
    assert.equal(
      recovery.reachedTakeoutUniqueDriverOfferLimit(driverA, driverA),
      false,
    );
    assert.equal(
      recovery.reachedTakeoutUniqueDriverOfferLimit(driverA, driverB),
      true,
    );
  });

  await test('exhausted Takeout stays exhausted after manual recovery driver also times out', async () => {
    const driverA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const driverB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const driverC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const db = makeDb({
      id: '99999999-9999-4999-8999-999999999999',
      booking_code: 'TO-EXHAUSTION-TEST',
      service_type: 'takeout',
      status: 'assigned',
      vendor_status: 'driver_assigned',
      customer_status: 'driver_assigned',
      driver_status: 'driver_assigned',
      assigned_driver_id: driverA,
      driver_id: driverA,
      driver_accept_expires_at: expiredAt,
      takeout_driver_accept_expires_at: expiredAt,
      takeout_customer_confirmed_at: null,
      takeout_fee_proposed_at: null,
      takeout_delivery_fee: null,
      takeout_auto_dispatch_exhausted: false,
      takeout_auto_dispatch_exhausted_at: null,
      last_expired_driver_id: null,
    });

    let result = await recovery.resetExpiredTakeoutDriverAcceptance(db, {
      bookingId: db.row.id,
      bookingCode: db.row.booking_code,
      expiredDriverId: driverA,
      markDriverUnavailable: false,
    });
    assert.equal(result.didReset, true);
    assert.equal(db.row.status, 'searching');
    assert.equal(db.row.takeout_auto_dispatch_exhausted, false);

    Object.assign(db.row, {
      status: 'assigned',
      vendor_status: 'driver_assigned',
      customer_status: 'driver_assigned',
      driver_status: 'driver_assigned',
      assigned_driver_id: driverB,
      driver_id: driverB,
      driver_accept_expires_at: expiredAt,
      takeout_driver_accept_expires_at: expiredAt,
      takeout_pricing_status: 'waiting_driver_accept',
    });

    result = await recovery.resetExpiredTakeoutDriverAcceptance(db, {
      bookingId: db.row.id,
      bookingCode: db.row.booking_code,
      expiredDriverId: driverB,
      markDriverUnavailable: true,
    });
    assert.equal(result.didReset, true);
    assert.equal(db.row.status, 'searching');
    assert.equal(db.row.vendor_status, 'driver_unavailable');
    assert.equal(db.row.customer_status, 'driver_unavailable');
    assert.equal(db.row.takeout_pricing_status, 'driver_unavailable');
    assert.equal(db.row.takeout_auto_dispatch_exhausted, true);
    assert.ok(db.row.takeout_auto_dispatch_exhausted_at);

    Object.assign(db.row, {
      status: 'assigned',
      vendor_status: 'driver_assigned',
      customer_status: 'driver_assigned',
      driver_status: 'driver_assigned',
      assigned_driver_id: driverC,
      driver_id: driverC,
      driver_accept_expires_at: expiredAt,
      takeout_driver_accept_expires_at: expiredAt,
      takeout_pricing_status: 'waiting_driver_accept',
      takeout_auto_dispatch_exhausted: true,
    });

    result = await recovery.resetExpiredTakeoutDriverAcceptance(db, {
      bookingId: db.row.id,
      bookingCode: db.row.booking_code,
      expiredDriverId: driverC,
      markDriverUnavailable: true,
    });
    assert.equal(result.didReset, true);
    assert.equal(db.row.status, 'searching');
    assert.equal(db.row.takeout_pricing_status, 'driver_unavailable');
    assert.equal(db.row.takeout_auto_dispatch_exhausted, true);
    assert.equal(db.row.last_expired_driver_id, driverC);
  });

  await test('Takeout dispatch keeps five-minute driver windows and blocks exhausted automatic reassignment', () => {
    const cron = fs.readFileSync(
      path.join(root, 'app/api/cron/takeout-expiry-recovery/route.ts'),
      'utf8',
    );
    const autoAssign = fs.readFileSync(
      path.join(root, 'app/api/dispatch/auto-assign/route.ts'),
      'utf8',
    );
    const manualAssign = fs.readFileSync(
      path.join(root, 'app/api/dispatch/assign/route.ts'),
      'utf8',
    );
    const takeoutDispatchAssign = fs.readFileSync(
      path.join(root, 'app/api/admin/takeout-dispatch/assign/route.ts'),
      'utf8',
    );
    const takeoutDispatchPage = fs.readFileSync(
      path.join(root, 'app/admin/takeout-dispatch/page.tsx'),
      'utf8',
    );
    const liveTrips = fs.readFileSync(
      path.join(root, 'app/admin/livetrips/LiveTripsClient.tsx'),
      'utf8',
    );
    const trackingPage = fs.readFileSync(
      path.join(root, 'app/takeout/track/[bookingCode]/page.tsx'),
      'utf8',
    );

    assert(cron.includes('markDriverUnavailable: reachedUniqueOfferLimit'));
    assert(cron.includes('two_unique_driver_accept_windows_expired'));
    assert(cron.includes('no_second_unique_driver_available'));
    assert(cron.includes('openTakeoutDriverUnavailableOperationsCase'));
    assert(autoAssign.includes('TAKEOUT_DRIVER_UNAVAILABLE_STATUS'));
    assert(autoAssign.includes('TAKEOUT_DRIVER_UNAVAILABLE'));
    assert(autoAssign.includes('takeout_auto_dispatch_exhausted'));
    assert(
      autoAssign.includes(
        'takeout_pricing_status.is.null,takeout_pricing_status.neq.driver_unavailable',
      ),
    );
    assert(
      autoAssign.includes(
        'takeout_auto_dispatch_exhausted.is.null,takeout_auto_dispatch_exhausted.eq.false',
      ),
    );
    assert(autoAssign.includes('new Date(Date.now() + 5 * 60 * 1000)'));
    assert(manualAssign.includes('const TAKEOUT_DRIVER_ACCEPT_TTL_SECONDS = 300'));
    assert(manualAssign.includes('takeout_manual_driver_required'));
    assert(manualAssign.includes('updatePayload.takeout_pricing_status = "waiting_driver_accept"'));
    assert(takeoutDispatchAssign.includes('"driver_unavailable"'));
    assert(takeoutDispatchAssign.includes('takeout_auto_dispatch_exhausted: preserveAutoDispatchExhausted'));
    assert(takeoutDispatchPage.includes('"driver_unavailable"'));
    assert(liveTrips.includes('"driver_unavailable"'));
    assert(liveTrips.includes('serviceType === "takeout"'));
    assert(trackingPage.includes('No driver currently available - JRide Operations has been notified'));
  });

  await test('cron keeps driver-accept expiry reassignment but never reassigns an expired passenger quote', () => {
    const cron = fs.readFileSync(
      path.join(root, 'app/api/cron/takeout-expiry-recovery/route.ts'),
      'utf8',
    );
    const feeSection = cron.split(
      'const { data: candidateRows, error: scanError }',
    )[1];

    assert(cron.includes('resetExpiredTakeoutDriverAcceptance'));
    assert(cron.includes('driver_accept_expired_cron_sweep'));
    assert(cron.includes('triggerTakeoutFeeProposalReassign'));
    assert(feeSection.includes('cancelExpiredTakeoutPassengerFareConfirmation'));
    assert(feeSection.includes('notifyTakeoutFareTimeoutDriver'));
    assert(feeSection.includes('expectedTakeoutFeeProposedAt'));
    assert(feeSection.includes('expectedTakeoutFeeExpiresAt'));
    assert(feeSection.includes('expectedDriverFeeProposalExpiresAt'));
    assert(!feeSection.includes('resetExpiredTakeoutFeeProposal'));
    assert(!feeSection.includes('fee_proposal_expired_cron_sweep'));
    assert(!feeSection.includes('triggerTakeoutFeeProposalReassign('));
  });

  await test('late passenger confirmation remains server-rejected after cancellation or deadline expiry', () => {
    const confirmRoute = fs.readFileSync(
      path.join(root, 'app/api/takeout/confirm-fee/route.ts'),
      'utf8',
    );
    assert(confirmRoute.includes('TAKEOUT_ALREADY_CANCELLED'));
    assert(confirmRoute.includes('TAKEOUT_FEE_PROPOSAL_EXPIRED'));
    assert(confirmRoute.includes('.gt("takeout_fee_expires_at", nowIso)'));
  });

  console.log(
    passed + ' TakeOut expiry recovery checks passed. No network or live data used.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
