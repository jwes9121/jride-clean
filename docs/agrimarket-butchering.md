# Scheduled butchering and meat cuts

The farmer Products page offers **Schedule butchering**. Farmers choose the animal, butchering start, optional finish, and reservation cutoff in Philippine time, then add up to 30 cuts. Each cut has its own positive PHP price per kilo and expected available kilos (up to two decimal places). Saved cuts get independent product cards with the existing photo, stock and pause controls.

The normal live-animal listing remains available. A butchering batch creates meat products, not live-animal cargo. Each selling unit is one kilogram; vehicle eligibility uses ordered kilos and the existing pickup access, load confirmation and customer reapproval rules.

## API

`POST /api/agrimarket/producer/butchering` uses the existing farmer access-code/PIN headers and server-derived producer identity. It requires the farmer portal flag and active producer login. Maximum JSON body size is 64 KiB.

Fields: `request_id` (UUID v4), `species`, optional `breed` and `description`, `butcher_start_at`, optional `butcher_end_at`, `order_cutoff_at`, `condition` (`fresh` or `chilled`), `vehicle_requirement` (`either`, `motorcycle`, `tricycle`), `default_prep_minutes`, boolean `is_active`, and `cuts` containing `name`, `price_per_kg`, and `available_kg`. Dates use ISO timestamps with an explicit timezone. The cutoff must be in the future and strictly before butchering; finish cannot precede start.

Success returns `{ ok: true, batch: { request_id, product_ids, replayed } }`. All cuts save in one database transaction. Retrying the same request and normalized payload returns the same product IDs, including after the cutoff has passed. Reusing a request ID with different details returns 409. The form retains the attempted request across reloads until the result is confirmed. Correctable validation errors return 400; oversized requests return 413. Unconfirmed database results return 503 and must be retried with the same payload.

Apply `20260907045104_agrimarket_butchering_cuts_v1.sql` before releasing the endpoint. Its receipt table and RPC are private to the service role; public and authenticated clients cannot call the function or read receipts directly.

## Existing order contract

The wire values `scheduled_harvest`, `harvest_start_at`, `harvest_end_at`, and `harvest_order_cutoff_at` are preserved for compatibility. Meat snapshots identify the schedule as butchering. Catalog, quote fulfillment, customer order status and farmer order responses add `scheduled_activity`: `butchering`, `harvest`, `preparation` (mixed products), or null for always available products. Quote item snapshots include `product_group`, `species`, and `meat_cut`.

Customer reservations use each cut's stock and price. Farmer acceptance waits in the existing scheduled state; readiness and load confirmation precede dispatch. Delays and shortfalls use the existing customer approval flow. Vendor personal details remain private to the vendor, Admin and assigned driver.

This farmer interface loads inside the existing Passenger Android AgriMarket WebView. No new native permission or APK is required for these fields. Full combined Errand/AgriMarket Android release acceptance remains a separate release gate.

## Verification

- `node --test scripts/test-agrimarket-butchering.cjs` validates species/cuts, money and stock precision, schedule timezones, farmer ownership, body limits and retry conflicts.
- `node scripts/test-agrimarket-db.cjs` uses disposable loopback PostgreSQL only and rolls back all migrations and fixtures. It checks atomic rollback, retry receipts, independent cut reservations, price totals, kilogram-based load and readiness before dispatch.
- Browser verification covers mobile/desktop, editable validation errors, saved drafts, interrupted-save retries, private vendor identity, customer catalog and scheduled cart copy.
