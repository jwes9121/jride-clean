'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');

const page = fs.readFileSync('app/jfleet/demo/page.tsx','utf8');
const client = fs.readFileSync('app/jfleet/demo/DemoClient.tsx','utf8');

const checks = [
  ['production is blocked', page.includes('VERCEL_ENV === "production"') && page.includes('notFound()')],
  ['demo clearly says no database writes', client.includes('PREVIEW ONLY - NO DATABASE WRITES')],
  ['Yakalites name is visible', client.includes('Yakalites Transport')],
  ['passenger tab exists', client.includes('Passenger')],
  ['owner tab exists', client.includes('Yakalites Owner')],
  ['driver tab exists', client.includes('Driver')],
  ['security tab exists', client.includes('Security')],
  ['20 percent rule visible', client.includes('Minimum reservation payment: 20%')],
  ['3 hour target visible', client.includes('Target response within 3 hours')],
  ['driver start blocked before full payment', client.includes('Blocked: owner must confirm full payment before Start Trip.')],
  ['security route deviation visible', client.includes('Distance from approved route')],
  ['demo is ASCII', !/[^\x00-\x7F]/.test(page + client)],
];

for (const [name, ok] of checks) {
  assert.ok(ok, name);
  console.log('PASS ' + name);
}
console.log('JFleet web UI demo checks: ' + checks.length + ' passed.');
