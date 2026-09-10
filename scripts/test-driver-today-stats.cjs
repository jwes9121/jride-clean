// Run with: node scripts/test-driver-today-stats.cjs
// Executes the real route and Supabase query builder against an in-memory HTTP
// fixture. No production credentials, network requests, or writes are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const NOW = '2026-09-10T04:00:00.000Z';
const DRIVER = 'test-driver';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return new Date(NOW).getTime(); }
}

const source = ts.transpileModule(
  fs.readFileSync('app/api/driver/today-stats/route.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;

function loadRoute(rows, options = {}) {
  const requests = [];
  async function fakeFetch(input, init = {}) {
    const url = new URL(String(input));
    const table = url.pathname.split('/').pop();
    const method = init.method || 'GET';
    const headers = new Headers(init.headers);
    requests.push({ table, method, url, headers });
    assert.ok(['GET', 'HEAD'].includes(method), 'Stats must never mutate data');
    assert.ok(Object.hasOwn(rows, table), `Unexpected table: ${table}`);
    if (options.failTable === table) {
      return new Response(null, { status: 400, statusText: 'Fixture failure' });
    }
    let result = rows[table].filter(row => {
      for (const [column, expression] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(column)) continue;
        if (column === 'or') {
          const alternatives = expression.slice(1, -1).split(',');
          if (!alternatives.some(term => {
            const [key, operator, ...value] = term.split('.');
            assert.equal(operator, 'eq');
            return String(row[key]) === value.join('.');
          })) return false;
          continue;
        }
        const dot = expression.indexOf('.');
        const operator = expression.slice(0, dot);
        const value = expression.slice(dot + 1);
        if (row[column] == null) return false;
        if (operator === 'eq' && String(row[column]) !== value) return false;
        if (operator === 'gte' && Date.parse(row[column]) < Date.parse(value)) return false;
        if (operator === 'lt' && Date.parse(row[column]) >= Date.parse(value)) return false;
        assert.ok(['eq', 'gte', 'lt'].includes(operator), `Unexpected operator: ${operator}`);
      }
      return true;
    });
    const count = result.length;
    if (url.searchParams.has('limit')) result = result.slice(0, Number(url.searchParams.get('limit')));
    const responseHeaders = { 'Content-Type': 'application/json' };
    if (headers.get('Prefer')?.includes('count=exact') && !options.omitCount) {
      responseHeaders['Content-Range'] = `*/${count}`;
    }
    return new Response(method === 'HEAD' ? null : JSON.stringify(result), { status: 200, headers: responseHeaders });
  }
  const exports = {};
  vm.runInNewContext(source, {
    exports, Date: FixedDate, URL, console,
    process: { env: {} },
    require: id => id === '@supabase/supabase-js' ? {
      createClient: () => createClient('https://stats-fixture.invalid', 'fixture-key', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: fakeFetch }
      })
    } : require(id)
  }, { filename: 'today-stats-route.js' });
  return { GET: exports.GET, requests };
}

function fixtures() {
  const agri = (id, completed_at, extra = {}) => ({ id, assigned_driver_id: DRIVER, status: 'completed', completed_at, ...extra });
  const booking = (service_type, extra = {}) => ({ driver_id: DRIVER, status: 'completed', service_type, completed_at: NOW, ...extra });
  return {
    bookings: [booking('ride'), booking('takeout'), booking('errand'),
      booking('ride', { driver_id: 'someone-else' }),
      booking('ride', { completed_at: '2026-09-09T15:59:59.999Z' })],
    agrimarket_orders: [
      agri('midnight-included', '2026-09-09T16:00:00.000Z'),
      agri('last-millisecond-included', '2026-09-10T15:59:59.999Z'),
      agri('previous-day-excluded', '2026-09-09T15:59:59.999Z'),
      agri('next-day-excluded', '2026-09-10T16:00:00.000Z'),
      agri('other-driver-excluded', NOW, { assigned_driver_id: 'someone-else' }),
      agri('cancelled-excluded', NOW, { status: 'cancelled' }),
      agri('not-completed-excluded', NOW, { status: 'delivering' }),
      agri('missing-timestamp-excluded', null)
    ],
    driver_presence_sessions: [{ driver_id: DRIVER, login_at: '2026-09-10T00:00:00.000Z', logout_at: '2026-09-10T01:00:00.000Z' }]
  };
}

async function read(route, driver = DRIVER) {
  const response = await route.GET({ url: `https://app.invalid/api/driver/today-stats?driver_id=${driver}` });
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  return { status: response.status, body: await response.json() };
}

(async () => {
  const route = loadRoute(fixtures());
  const first = await read(route);
  assert.equal(first.status, 200);
  assert.equal(first.body.date, '2026-09-10');
  assert.equal(first.body.agrimarket_completed, 2);
  assert.equal(first.body.ride_completed, 1);
  assert.equal(first.body.takeout_completed, 1);
  assert.equal(first.body.errand_completed, 1);
  assert.equal(first.body.total_completed, 5);
  for (const key of ['today_online_minutes', 'week_online_minutes', 'month_online_minutes']) {
    assert.equal(first.body[key], 60, `${key} should preserve presence accounting`);
  }
  const countRequest = route.requests.find(r => r.table === 'agrimarket_orders');
  assert.equal(countRequest.method, 'HEAD');
  assert.match(countRequest.headers.get('Prefer'), /count=exact/);
  assert.equal(countRequest.url.searchParams.has('limit'), false);
  console.log('PASS driver ownership, completed status, Manila midnight boundaries, other services, online time');

  assert.deepEqual(await read(route), first);
  console.log('PASS repeated refresh is read-only and does not double count');

  const emptyRows = fixtures();
  emptyRows.agrimarket_orders = [];
  const empty = await read(loadRoute(emptyRows));
  assert.equal(empty.status, 200);
  assert.equal(empty.body.agrimarket_completed, 0);
  assert.equal(empty.body.total_completed, 3);
  console.log('PASS zero AgriMarket completions preserves other service total');

  const manyRows = fixtures();
  manyRows.agrimarket_orders = Array.from({ length: 1001 }, (_, id) => ({ id, assigned_driver_id: DRIVER, status: 'completed', completed_at: NOW }));
  const many = await read(loadRoute(manyRows));
  assert.equal(many.body.agrimarket_completed, 1001);
  assert.equal(many.body.total_completed, 1004);
  console.log('PASS exact count is not truncated at the usual 1000-row limit');

  for (const options of [{ failTable: 'agrimarket_orders' }, { omitCount: true }, { failTable: 'bookings' }]) {
    const failed = await read(loadRoute(fixtures(), options));
    assert.equal(failed.status, 500);
    assert.equal(failed.body.ok, false);
    assert.equal(failed.body.total_completed, undefined);
  }
  console.log('PASS failed or missing counts cannot return a misleading successful total');

  const missingDriver = loadRoute(fixtures());
  assert.equal((await read(missingDriver, '')).status, 400);
  assert.equal(missingDriver.requests.length, 0);
  console.log('PASS missing driver is rejected before querying');
})().catch(error => { console.error(error); process.exitCode = 1; });
