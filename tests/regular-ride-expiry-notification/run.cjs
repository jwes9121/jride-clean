const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const baselinePath = path.join(
  root,
  'supabase/migrations/20260903122529_regular_ride_expiry_authority_v1.sql',
);
const migrationPath = path.join(
  root,
  'supabase/migrations/20260917125500_regular_ride_fare_timeout_driver_notification_v1.sql',
);

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function extractExpiryFunction(sql) {
  const startMarker = 'create or replace function public.expire_regular_ride_windows_v1(';
  const start = sql.indexOf(startMarker);
  assert.notEqual(start, -1, 'expiry function start not found');

  const bodyEnd = sql.indexOf('\n$$;', start);
  assert.notEqual(bodyEnd, -1, 'expiry function end not found');
  return sql.slice(start, bodyEnd + '\n$$;'.length);
}

function normalize(sql) {
  return sql.replace(/[ \t]+$/gm, '').trim();
}

const baseline = extractExpiryFunction(read(baselinePath));
const migration = extractExpiryFunction(read(migrationPath));

const notificationBlock = `
      if candidate.assigned_driver is not null then
        insert into public.driver_notifications (
          driver_id,
          type,
          message
        )
        values (
          candidate.assigned_driver,
          'fare_response_timeout',
          format(
            'Ride booking %s was cancelled because the passenger did not respond to the fare proposal within 5 minutes. You may accept another booking.',
            coalesce(candidate.booking_code, candidate.id::text)
          )
        );
      end if;
`;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('PASS: ' + name);
}

test('migration changes the expiry RPC only by adding the intended notification block', () => {
  assert.equal(migration.split(notificationBlock).length - 1, 1);
  assert.equal(
    normalize(migration.replace(notificationBlock, '\n')),
    normalize(baseline),
  );
});

test('driver notification is only in the passenger-owned timeout branch', () => {
  const passengerBranch = migration.indexOf("    else\n      update public.bookings booking");
  const notification = migration.indexOf('insert into public.driver_notifications');
  const lifecycle = migration.indexOf("'fare_response_expired'", passengerBranch);

  assert.notEqual(passengerBranch, -1);
  assert(notification > passengerBranch);
  assert(notification < lifecycle);
  assert.equal(
    migration.slice(0, passengerBranch).includes('driver_notifications'),
    false,
  );
});

test('notification occurs only after the terminal cancellation CAS succeeds', () => {
  const passengerBranch = migration.indexOf("    else\n      update public.bookings booking");
  const successfulCasGuard = migration.indexOf(
    '      if updated_id is null then\n        continue;\n      end if;',
    passengerBranch,
  );
  const notification = migration.indexOf('insert into public.driver_notifications');

  assert(successfulCasGuard > passengerBranch);
  assert(notification > successfulCasGuard);
});

test('passenger timeout remains cancelled with reassignment disabled', () => {
  const passengerBranch = migration.indexOf("    else\n      update public.bookings booking");
  const passengerSql = migration.slice(passengerBranch);

  assert.match(passengerSql, /status = 'cancelled'/);
  assert.match(passengerSql, /ride_reassignment_pending = false/);
  assert.match(passengerSql, /needs_reassignment := false/);
  assert.match(passengerSql, /'reassign', false/);
});

test('notification identifies the timeout and releases the driver for another booking', () => {
  assert.match(migration, /'fare_response_timeout'/);
  assert.match(migration, /did not respond to the fare proposal within 5 minutes/);
  assert.match(migration, /You may accept another booking\./);
});

console.log(`\n${passed} regular ride expiry notification regression groups passed.`);
