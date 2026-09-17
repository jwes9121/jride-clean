const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const passengerId = '11111111-1111-4111-8111-111111111111';
const driverId = '22222222-2222-4222-8222-222222222222';
const bookingId = '33333333-3333-4333-8333-333333333333';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeHarness(overrides = {}, options = {}) {
  const row = {
    id: bookingId,
    booking_code: 'JR-FARE-RESPONSE-TEST',
    status: 'fare_proposed',
    created_by_user_id: passengerId,
    driver_id: driverId,
    assigned_driver_id: driverId,
    driver_status: 'accepted',
    assigned_at: '2026-09-17T10:00:00.000Z',
    driver_accept_expires_at: '2026-09-17T10:05:00.000Z',
    passenger_fare_response: null,
    driver_fee_proposal_expires_at: '2999-01-01T00:00:00.000Z',
    proposed_fare: 75,
    verified_fare: 75,
    driver_to_pickup_km: 2.4,
    pickup_distance_fee: 40,
    last_expired_driver_id: null,
    ride_reassignment_pending: true,
    ride_reassignment_queued_at: '2026-09-17T10:00:00.000Z',
    ride_reassignment_next_attempt_at: '2026-09-17T10:01:00.000Z',
    cancel_reason: null,
    updated_at: '2026-09-17T10:00:00.000Z',
    ...overrides,
  };
  const rpcCalls = [];
  const notifications = [];
  let updateCount = 0;

  function serviceClient() {
    return {
      auth: {
        async getUser() {
          return { data: { user: { id: passengerId } }, error: null };
        },
      },
      async rpc(name, args) {
        rpcCalls.push({ name, args: clone(args) });
        return { data: { ok: true, status: 'released' }, error: null };
      },
      from(table) {
        if (table === 'driver_notifications') {
          return {
            async insert(value) {
              notifications.push(clone(value));
              return { data: null, error: null };
            },
          };
        }

        assert.equal(table, 'bookings');
        let mode = 'read';
        let patch = null;
        const filters = [];

        const query = {
          select() {
            return query;
          },
          limit() {
            return query;
          },
          eq(key, value) {
            filters.push((candidate) => String(candidate[key] ?? '') === String(value ?? ''));
            return query;
          },
          is(key, value) {
            filters.push((candidate) => (candidate[key] ?? null) === value);
            return query;
          },
          gt(key, value) {
            filters.push((candidate) => Date.parse(candidate[key]) > Date.parse(value));
            return query;
          },
          update(value) {
            mode = 'update';
            patch = value;
            if (options.replaceProposalBeforeCas) {
              row.driver_fee_proposal_expires_at = '2999-02-01T00:00:00.000Z';
              row.assigned_driver_id = '44444444-4444-4444-8444-444444444444';
            }
            return query;
          },
          async maybeSingle() {
            const matches = filters.every((check) => check(row));
            return { data: matches ? clone(row) : null, error: null };
          },
          then(resolve, reject) {
            return Promise.resolve().then(() => {
              const matches = filters.every((check) => check(row));
              if (mode === 'update' && matches) {
                assert(patch, 'update patch is required');
                updateCount += 1;
                Object.assign(row, patch);
                return { data: [clone(row)], error: null };
              }
              return { data: [], error: null };
            }).then(resolve, reject);
          },
        };

        return query;
      },
    };
  }

  const service = serviceClient();
  const anon = {
    auth: {
      async getUser() {
        return { data: { user: { id: passengerId } }, error: null };
      },
    },
  };
  const cookie = {
    auth: {
      async getUser() {
        return { data: { user: { id: passengerId } }, error: null };
      },
    },
  };

  class NextResponse {
    constructor(body, status = 200, headers = {}) {
      this.body = body;
      this.status = status;
      this.headers = headers;
    }
    static json(body, opts = {}) {
      return new NextResponse(body, opts.status || 200, opts.headers || {});
    }
  }

  const module = { exports: {} };
  const source = fs.readFileSync(
    path.join(root, 'app/api/rides/fare-response/route.ts'),
    'utf8',
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const localRequire = (name) => {
    if (name === 'next/server') return { NextResponse };
    if (name === '@/utils/supabase/server') return { createClient: () => cookie };
    if (name === '@supabase/supabase-js') {
      return {
        createClient: (_url, key) => key === 'test-service' ? service : anon,
      };
    }
    return require(name);
  };

  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: localRequire,
      process: {
        env: {
          SUPABASE_URL: 'https://fixture.invalid',
          NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid',
          SUPABASE_SERVICE_ROLE_KEY: 'test-service',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon',
        },
      },
      Date,
      Number,
      String,
      JSON,
      console,
    },
    { filename: 'app/api/rides/fare-response/route.ts' },
  );

  function request(action) {
    return {
      url: 'https://fixture.invalid/api/rides/fare-response',
      headers: new Headers({ authorization: 'Bearer fixture-token' }),
      async json() {
        return { booking_id: bookingId, response: action };
      },
    };
  }

  return {
    api: module.exports,
    request,
    row,
    rpcCalls,
    notifications,
    get updateCount() {
      return updateCount;
    },
  };
}

(async () => {
  let passed = 0;
  async function test(name, fn) {
    await fn();
    passed += 1;
    console.log('PASS: ' + name);
  }

  await test('accept before deadline keeps the assigned driver and moves ride to ready', async () => {
    const h = makeHarness();
    const response = await h.api.POST(h.request('accept'));

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ready');
    assert.equal(response.body.passenger_fare_response, 'accepted');
    assert.equal(h.row.status, 'ready');
    assert.equal(h.row.assigned_driver_id, driverId);
    assert.equal(h.row.driver_id, driverId);
    assert.equal(h.row.driver_fee_proposal_expires_at, null);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.notifications.length, 0);
  });

  await test('decline before deadline cancels terminally, releases driver, and never reassigns', async () => {
    const h = makeHarness();
    const response = await h.api.POST(h.request('reject'));

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'cancelled');
    assert.equal(response.body.passenger_fare_response, 'rejected');
    assert.equal(response.body.reassign.attempted, false);
    assert.equal(response.body.reassign.skipped, true);
    assert.equal(h.row.status, 'cancelled');
    assert.equal(h.row.assigned_driver_id, null);
    assert.equal(h.row.driver_id, null);
    assert.equal(h.row.driver_status, null);
    assert.equal(h.row.assigned_at, null);
    assert.equal(h.row.driver_accept_expires_at, null);
    assert.equal(h.row.driver_fee_proposal_expires_at, null);
    assert.equal(h.row.ride_reassignment_pending, false);
    assert.equal(h.row.ride_reassignment_queued_at, null);
    assert.equal(h.row.ride_reassignment_next_attempt_at, null);
    assert.equal(
      h.row.cancel_reason,
      'Passenger declined the fare proposal. Please book again if you still need a ride.',
    );

    assert.equal(h.row.proposed_fare, 75);
    assert.equal(h.row.verified_fare, 75);
    assert.equal(h.row.driver_to_pickup_km, 2.4);
    assert.equal(h.row.pickup_distance_fee, 40);
    assert.equal(h.row.last_expired_driver_id, null);

    assert.equal(h.rpcCalls.length, 1);
    assert.equal(h.rpcCalls[0].name, 'jride_promo_release_for_booking');
    assert.deepEqual(h.rpcCalls[0].args, {
      p_booking_id: bookingId,
      p_customer_id: passengerId,
      p_reason: 'passenger_fare_rejected',
    });

    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0].driver_id, driverId);
    assert.equal(h.notifications[0].type, 'fare_declined');
    assert.match(h.notifications[0].message, /passenger declined the fare proposal/i);
  });

  await test('late decline is rejected without changing the booking or sending side effects', async () => {
    const h = makeHarness({
      driver_fee_proposal_expires_at: '2000-01-01T00:00:00.000Z',
    });
    const response = await h.api.POST(h.request('reject'));

    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'FARE_PROPOSAL_EXPIRED_OR_CHANGED');
    assert.equal(h.row.status, 'fare_proposed');
    assert.equal(h.updateCount, 0);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.notifications.length, 0);
  });

  await test('retry after successful decline is idempotent and cannot duplicate side effects', async () => {
    const h = makeHarness();
    const first = await h.api.POST(h.request('reject'));
    const second = await h.api.POST(h.request('reject'));

    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'INVALID_STATUS');
    assert.equal(h.updateCount, 1);
    assert.equal(h.rpcCalls.length, 1);
    assert.equal(h.notifications.length, 1);
  });

  await test('proposal or driver replacement before CAS prevents stale decline cancellation', async () => {
    const h = makeHarness({}, { replaceProposalBeforeCas: true });
    const response = await h.api.POST(h.request('reject'));

    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'FARE_PROPOSAL_EXPIRED_OR_CHANGED');
    assert.equal(h.row.status, 'fare_proposed');
    assert.equal(h.updateCount, 0);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.notifications.length, 0);
  });

  console.log(`\n${passed} regular ride fare response regression groups passed.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
