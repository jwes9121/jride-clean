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
