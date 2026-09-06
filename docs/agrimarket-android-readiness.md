# AgriMarket Android readiness changes

This change closes the diagnosed authentication, location, pickup-access and load-mismatch gaps. It does not enable the customer marketplace or public farmer onboarding.

## API changes

- Driver offer, decision and action routes require an individual Supabase bearer token. An explicit `driver_id` must match the authenticated account's driver profile. The shared driver secret no longer grants access to these AgriMarket routes.
- `GET /api/driver/agrimarket/session` validates that account mapping and returns `driver_id`. It is available while the marketplace is disabled so driver sign-in can be tested before launch.
- Assigned jobs include verified pickup directions, access facts and farmer contact. Private farmer identity and coordinates remain excluded from customer responses and unaccepted offers.
- Checkout rejects missing/invalid coordinates and a delivery pin that cannot resolve to a supported municipality. Catalog returns `ordering_enabled` and `ordering_blocker` so clients can explain a location block.
- `AGRIMARKET_FARMER_PORTAL_ENABLED=true` permits farmer login and product setup while `AGRIMARKET_ENABLED=false`. Farmer orders return an empty setup-only response; order mutations still require the marketplace switch.

Existing locked pricing and vehicle rules remain authoritative. Clients display the server-confirmed heavy-load and special-handling charges; drivers cannot add a handling fee.

## Pickup mismatch and cash return

The action API uses `agrimarket_driver_execute_v2`. Before pickup, `report_load_mismatch` with a nonempty `reason`, or a failed item check, opens a pickup issue. Normal driver actions stop while the issue is open. Database guards also prevent the legacy RPC from replacing a failed check with PASS or completing pickup.

For cancellation, `confirm_farmer_refund` and `confirm_customer_refund` accept the exact `amount` previously paid/collected. The farmer's return must be confirmed first when applicable. These are driver attestations of physical cash movement, not electronic transfers.

Authenticated staff use the existing admin dispatch POST endpoint with:

```json
{
  "action": "resolve_pickup_issue",
  "order_code": "<order code>",
  "resolution": "restored_to_booking",
  "note": "<staff verification note>"
}
```

`restored_to_booking` requires the original booked load, price and vehicle to be restored and is blocked once any refund is recorded. It archives prior checks and requires fresh physical checks. Alternatively, `resolution=cancel` requires all applicable cash-return confirmations and releases inventory once. A materially changed load or vehicle requires a new customer-approved booking. Customer tracking exposes only a generic pause message.

## Migration and rollout order

1. Review and apply only `20260906031754_agrimarket_android_readiness_guards_v1.sql` to the intended test environment before deploying the matching API. Historical repository/live migration timestamps differ; do not blindly push the entire old migration directory to production.
2. Deploy this backend with the customer marketplace and public onboarding disabled. Enable the independent farmer-portal flag only for intended setup testing.
3. Pair it with the updated Android driver source. The companion obtains an individual session, verifies driver mapping, encrypts tokens with Android Keystore and uses bearer authentication for AgriMarket.
4. Exercise real driver login/refresh, verified farmer setup, customer checkout/reapproval, offer/acceptance, mismatch restoration/cancellation, pickup, delivery and settlement in staging and on a target device before a pilot.

No live database, feature flag or account changes are included. Verified farmer contact/access data, operational products and linked driver accounts are prerequisites. Public onboarding map/application unification and the passenger Android shopping client remain separate work.

## Validation

- `node --test scripts/test-agrimarket-api.cjs`: seven test groups using actual TypeScript modules with controlled dependencies.
- `node scripts/test-agrimarket-db.cjs`: all 38 AgriMarket migrations replayed and 31 assertions passed in a disposable local PostgreSQL transaction. The runner is fixed to `127.0.0.1:55439`, database `postgres`, role `agrimarket_test`; use a fresh disposable cluster with permission to create test roles and set `PSQL_BIN` if PostgreSQL is installed elsewhere. Related JRide tables are minimal fixtures, not a production clone.
- TypeScript validation and a full production build passed with placeholder backend configuration.
- Browser verification confirmed the farmer product-manager login stays on its farmer route without captured browser errors/warnings.
- Android `:app:compileDriverDebugKotlin --offline --console=plain` passed in both an isolated full source copy and the actual project after application. Device sign-in, token refresh and Keystore behavior remain unverified.

Checkout retries reuse a request key for an unchanged cart while the page remains open; persistence across a browser reload remains a nonblocking follow-up for controlled integration testing.
