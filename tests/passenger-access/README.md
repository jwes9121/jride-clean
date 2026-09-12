# Passenger private access

Passenger clients use JRide API routes. These routes validate the Auth identity before using server credentials for passenger records and session/promo functions. Booking ownership and driver assignment checks remain required.

The migration restricts 12 passenger tables, three dependent views, and 17 functions to server access. Verification requests become server-only so passengers cannot set their own approval status. Legacy staff approval endpoints use trusted app metadata or the existing server allowlists. No records or balances are changed by the migration.

## Validation

- `npm run test:passenger-access`: 16 groups, real route handlers with public data access denied.
- `npm run test:driver-duty`: 11 groups.
- `npm run test:vendor-workflow`: 23 groups.
- `check-permissions.cjs`: 96 real PostgreSQL permission probes in a temporary localhost database seeded exclusively with `permission-fixture.sql`, then the exact migration. Public table/view/function access must fail; server access must succeed. Set PSQL_BIN if needed. The script deliberately targets only 127.0.0.1:55497.
- Full local Next.js build uses fabricated configuration. Deployment must be built again by the hosting platform with its existing environment.

## Deployment order

1. Deploy this server revision and confirm that the production domain points to a Ready deployment of the tested commit.
2. Apply `20260912124428_passenger_private_access_v1.sql` atomically. Its assertions abort if any public privilege remains or server access is missing.
3. Verify production catalog grants and test existing passenger sessions, profile/address access, verification status, and a completed Agrimarket order without placing new orders.

Do not deploy an older version of the affected routes after the migration: old routes depend on the access being removed. Correct any regression through the authenticated server routes, keeping passenger data private.

This is a scoped passenger access correction. It does not certify every unrelated table or endpoint in the JRide project.
