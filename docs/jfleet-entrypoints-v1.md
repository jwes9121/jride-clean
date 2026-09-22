# JFleet reviewed entry points

This staged increment follows the customer revision branch (PR #106).
It does not merge the previous draft PRs, enable JFleet, activate an operator,
verify a permit, modify database policies, or change payment calculations.

## Navigation

- Passenger dashboard links to /jfleet as before.
- /jfleet now links to /jfleet/request for map-pinned requests and
  /jfleet/inquiries for full quotation review and revision history.
- Old address-only request fields and bare quote acceptance are removed from
  the home screen. Existing bookings, cancellation and side-trip controls remain.
- Each booking links back to its own inquiry and accepted quotation history.
- Owner inquiry cards link to /jfleet/owner/routes?inquiry_id=<id>.
  The route-review page validates the ID, opens that inquiry, and discards
  responses from an older selection. Server ownership checks remain in place.
- The legacy owner quote form is removed. Existing payment, assignment,
  side-trip proposal and add-on payment functions remain byte-for-byte unchanged.
- Authenticated POST /api/jfleet/inquiries now returns HTTP 410 with
  JFLEET_PINNED_REQUEST_REQUIRED and next_path=/jfleet/request. It neither
  writes an inquiry nor redirects an obsolete POST payload. The disabled gate
  and authentication run first; historical GET remains account-scoped.

## Additional home-screen corrections

A failed booking read is displayed as an error with a retry action, not as an
empty booking history. Accepted quotations are described as reservation pending.
Booking times are shown in Philippines time. The ordinary pre-trip cancellation
button is hidden for on-trip or already-due bookings; server cancellation rules
are unchanged.

## Verification commands

    node tests/jfleet-routing/run.cjs
    node tests/jfleet-owner-review/run.cjs
    node tests/jfleet-customer/run.cjs
    node tests/jfleet-entrypoints/run.cjs
    npx --no-install tsc --noEmit --pretty false

The dedicated read-only GitHub workflow also launches a local Next server and
runs tests/jfleet-entrypoints/browser.cjs with an isolated Playwright install.
The browser runner refuses non-loopback URLs. Every authentication/business API
response is a fixture, external requests are blocked, and maps are unavailable
or simulated. It exercises real page rendering, links, form acknowledgment,
revision navigation and error handling in desktop/mobile Chromium viewports.
It does NOT verify real credentials, database integration, real road routing,
physical Android behavior, native background tracking or notification delivery.
An existing owner route approval is seeded as a test fixture; live map approval
is not claimed. Screenshots, synthetic request logs and a JSON report are saved
as workflow artifacts. A failed assertion fails the job.

## Remaining activation gates

Finish real authenticated passenger/owner/device tests and map-provider tests.
Routed side-trip amendments, reliable owner/customer notifications, native
background GPS, route-deviation/tracking-gap alerts and document review remain
separate work. Public JFleet must stay disabled until separately authorized.
