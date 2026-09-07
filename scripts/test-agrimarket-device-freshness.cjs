// Integration regression against a running production Next build. Start Next
// with SUPABASE_URL=http://127.0.0.1:59999 and a local placeholder service key.
// Never points at production or changes real driver data.
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const api = new URL(process.env.AGRIMARKET_TEST_API_URL || 'http://127.0.0.1:3108');
assert.equal(api.hostname, '127.0.0.1', 'This regression only runs against a loopback app');
assert.equal(api.protocol, 'http:');
const driver = '00000000-0000-4000-8000-000000000002';
let status = 'pending';
let reads = 0;
const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/rest/v1/agrimarket_driver_devices?')) {
    res.writeHead(404); res.end(); return;
  }
  reads++;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ driver_id: driver, device_id: '1111111111111111', status, created_at: new Date().toISOString() }));
});
server.listen(59999, '127.0.0.1', async () => {
  try {
    const headers = { Authorization: `Bearer agdev.${randomUUID()}.${'a'.repeat(64)}`, 'x-jride-device-id': '1111111111111111' };
    for (const [next, expectedCode, expectedError] of [
      ['pending', 403, 'DRIVER_DEVICE_PENDING'],
      ['approved', 200, undefined],
      ['revoked', 403, 'DRIVER_DEVICE_REVOKED'],
    ]) {
      status = next;
      const response = await fetch(new URL('/api/driver/agrimarket/session', api), { headers });
      const result = await response.json();
      console.log(JSON.stringify({ databaseStatus: status, http: response.status, result, databaseReads: reads }));
      assert.equal(response.status, expectedCode, `${status} must take effect on the next request`);
      assert.equal(result.error, expectedError);
      if (next === 'approved') assert.equal(result.driver_id, driver);
    }
    assert.equal(reads, 3, 'Every phone authorization must read current database status');
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  } finally {
    server.close();
  }
});
