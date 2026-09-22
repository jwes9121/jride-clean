# JFleet map-pinned routing - staged implementation

Base: 1b07538274cb8f7e735e34e22f08c6eda377b95d.

## Scope

The new passenger path is /jfleet/request. Existing JFleet screens and the legacy inquiry endpoint are not replaced in this change. The same JRIDE_JFLEET_ENABLED server flag protects the planner. No company, vehicle or driver is activated, and no document verification flags are changed.

The passenger enters ordered labeled stops and explicitly confirms each map pin. Round trips append the pickup pin after the last destination. Map centers never become implicit customer coordinates. Editing a location invalidates its pin and the previous preview. The server calculates the road route, saves a passenger-scoped draft, and atomically binds the submitted draft to the new inquiry's itinerary. Duplicate submission of the same draft and details returns the original inquiry; altered points/details cannot reuse that submission.

The route is a planning estimate, not an approved safety corridor or a guarantee of truck access. No prices are automatically calculated from the route. Dates are interpreted explicitly in Philippines time. The confirmed 20% deposit, 48-hour cancellation cutoff and 10% late penalty are not changed.

## Technical defaults

- At most 21 points, matching pickup plus the previous 20-stop cap.
- 250-meter maximum snap to the routed road; no unlimited snapping.
- 12-second provider timeout; no straight-line fallback.
- Unsubmitted preview expires after 30 minutes.
- 20 previews per passenger per rolling hour, serialized in the database before external routing calls.
- Only public Mapbox tokens beginning pk. may be returned for browser rendering. Server tokens and upstream errors are never echoed.

## Validation

Run: node tests/jfleet-routing/run.cjs

The suite runs offline with mocked HTTP/auth, no credentials and no production mutations. It covers malformed pins, duplicate consecutive points, round trips, provider failures, geometry/waypoint checks, snap limits, schedule validation, auth/feature gates, and secret-token redaction. Full live map/provider and Android-device tests remain separate requirements.

## Remaining integration before activation

Replace the legacy typed-only request entry point with this screen after UI testing. Surface the saved route for owner review/quote preparation and record that approval before using it as a compliance corridor. Add versioned routed side-trip amendments, native Android background reporting, tracking-gap/deviation alerts, and owner notifications. Do not represent the current driver web page as persistent anti-theft vehicle tracking. Company documents may arrive while development continues, but verification remains evidence-based.

Primary API reference: https://docs.mapbox.com/api/navigation/directions/
