# JFleet customer revisions and full quotations

This increment is stacked on owner route review, not a public activation.

## Customer flow

- /jfleet/request uses the reusable CustomerItineraryEditor.
- /jfleet/inquiries lists the customer's latest 100 inquiries.
- /jfleet/inquiries/[id] shows the current saved route, owner feedback, quotation
  history, exact quoted itinerary, inclusions, exclusions, fuel basis, price
  breakdown, reservation amount and cancellation terms before acceptance.
- /jfleet/inquiries/[id]/revise preloads the current pins and details. The customer
  provides a revision reason, previews the route and acknowledges the new request.
- Resubmission retains the inquiry ID, creates an immutable itinerary/route-plan
  version, invalidates unaccepted quotes and requires fresh owner approval.
- The partner remains unchanged and the three-hour response window restarts.
- Identical retries return the saved result. Different payloads cannot reuse it.
- Accepted inquiries cannot be revised through this workflow.

## State and security

Customer identity comes from authenticated server helpers, never the request body.
Every customer read/write is owner-scoped and uses the existing JFleet feature gate.
The context fingerprint covers the saved route, owner decision, quotes and items,
partner state and the displayed payment/cancellation terms. Acceptance requires
that exact fingerprint, quote ID and an explicit acknowledgment. Quoted line items
cannot be rewritten; accepted/historical quotes cannot gain new items.

The old one-plan-per-inquiry uniqueness constraint is replaced by an ordinary
index. Each itinerary still references a unique route plan and only one itinerary
is current. Previous plans, reviews and revision receipts remain immutable.

The additive database migrations are applied while JFleet is disabled. No accounts,
vehicles, drivers or documents are activated. No original payment, commission,
cancellation or driver-location code is modified.

## Verification

Run node tests/jfleet-customer/run.cjs and the two parent JFleet test runners.
The offline runner mocks authentication, database and map-service dependencies.
Run full-project tsc and the Vercel build before considering a merge.
The database.sql suite uses two existing identity references only as foreign keys,
operates as service_role and ends in ROLLBACK. It never changes auth users or login
credentials. database-quote-integrity.sql covers line-item consent and expiry.
All fixture geography is simulated, not a real Mapbox route verification.

## Still required before activation

Authenticated desktop/mobile interaction, real map-provider tests, final legacy
entry-point cutover, operational notifications, routed in-trip amendments, native
background GPS and deviation/tracking-gap alerts remain separate work. The old
bare Accept Quote request is now rejected; customers must open the full quotation
page. The new JFleet customer navigation links to that flow. It does not replace
or claim completion of the existing bookings/driver/owner portals.
