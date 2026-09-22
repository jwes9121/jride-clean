# JFleet owner route review v1

This increment depends on the pinned routing work in PR #104. JFleet remains disabled. No operator account, vehicle, driver, permit or certification is activated or marked verified.

## Owner workflow

Open `/jfleet/owner/routes`, select an inquiry, and inspect its saved road geometry, numbered stops, schedule in Philippines time, vehicle request, passenger/cargo requirements and notes. The map is read-only. Approval requires a loaded map and an explicit review acknowledgment. Approval means operator acceptance of the quotation basis, not government authorization or a safe-road guarantee.

Approve the route or request changes with a reason. The decision and original snapshot remain in immutable review history. A new decision withdraws unaccepted quotations. The owner can then issue a quotation with explicit inclusions, exclusions, validity and fuel basis. The quotation request must include the approval actually displayed to the owner; a stale approval from another device is rejected.

## Database controls

Migration `20260922202911_jfleet_owner_route_review_v1` adds route reviews and reviewed-route references on quotations and bookings. Review, quotation and acceptance serialize on the inquiry row. Snapshot fingerprints include the ordered itinerary and pricing-relevant trip details. Submitted route plans and pinned itinerary contents cannot be overwritten; changes require a new version. Booking references retain the original reviewed route independently of future in-trip amendments. Server-only RPCs; direct anonymous/authenticated execution is revoked and RLS is enabled.

The existing owner quotation HTTP endpoint now requires `route_review_id` and uses `jfleet_owner_send_reviewed_quote_v1`. The legacy owner form does not supply this field and is rejected with instructions to open Route Review. The shared owner navigation exposes the new screen. The original pricing RPC is reused only after approval validation; price/deposit/cancellation/commission formulas are unchanged.

## Verified locally and transactionally

- 42 offline validation, API guard and JSX/source checks passed. Auth/database/map responses are mocked; these are not browser end-to-end tests.
- Strict standalone TypeScript check passed for `routeReview.ts`.
- 22 database checks passed under `service_role`, then all fixtures were rolled back: ownership, stale fingerprints, required acknowledgment/reasons, review idempotency, timezone stability, immutable evidence, exact quotation/booking binding, stale trip details, withdrawal and the unchanged 20 percent deposit.
- The first SQL test attempt stopped on an ambiguous variable in a test assertion. The assertion was qualified and the full suite rerun; no production function correction was needed for that harness error.

Run offline checks with `node tests/jfleet-owner-review/run.cjs` after dependencies are installed. Database test script requires session settings `jfleet.test_owner_id` and `jfleet.test_passenger_id` referencing dedicated auth test users; it wraps all changes in BEGIN/ROLLBACK. Do not turn test partners into operating accounts.

## Not delivered by this increment

Authenticated live map/mobile testing, customer editing and resubmission after a change request, passenger quotation-detail UI completion, legacy passenger entry-point cutover, owner notifications, routed side-trip amendments, native Android background GPS, route-deviation/tracking-gap alerts, and verification of real company/fleet/driver paperwork. The route review queue shows the first 50 inquiries and discloses when more exist; pagination remains a scale-up task.

Vercel build status and production feature-off verification are recorded separately in the PR after checking the exact commit.
