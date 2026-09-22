# JFleet real-authentication integration gate

Base: PR #107, commit b0aa156fcbd15477c5851c7918220420c21356a1.

This test-only increment runs the actual Next application against a disposable
Supabase CLI stack. It never links to a hosted project and does not need any
production credentials, company papers, passenger identities or service keys.

## Real components

- Supabase Auth / GoTrue creates four synthetic users via its admin API.
- The existing JRide login endpoint verifies passwords and writes SSR cookies.
- Independent owner sessions and a mobile-sized passenger browser use the actual
  application APIs, PostgREST and PostgreSQL JFleet functions.
- The seven JFleet migrations are copied unchanged from the checked-out commit.
- A real browser accepts a revised quotation; payment records are test-only,
  with no money transfer, driver assignment or external notification.
- Ownership, forged tokens, mandatory consent, stale quotations and idempotent
  retries are checked against real authentication/database responses.

## Deliberate limits

This is real authentication in an isolated environment, not a claim that hosted
production logins, social login, phone OTP, native APKs or physical devices work.
Map geometry is a simulated saved preview; no live Mapbox routing or UI map
approval is exercised. The owner approval is submitted through its actual API.
Ancillary passenger profile/verification tables are minimal test support tables,
not a full production-schema replica. No native device-session RPC is stubbed;
that code path is explicitly outside this test. No login details are exported.

## Isolation and cleanup

The workflow grants only repository read access and consumes no GitHub secrets.
It starts a fresh, unlinked local project on a loopback-bound Docker network.
The test runner rejects non-loopback API URLs before creating any accounts.
The Next child process receives only local Supabase credentials. Browser external
requests are blocked, not replaced with successful fixtures. Keys remain in a
private runner file and are excluded from artifacts. The stack is stopped without
backup; test users/data disappear with it. The evidence artifact contains only
sanitized reports, migration hashes, screenshots and cleanup status.

Run via .github/workflows/jfleet-real-auth.yml on the work branch. Results are not
claimed until the workflow, report and cleanup outputs have been inspected.
No production migration, feature activation, document approval, application
formula change or native APK release is part of this increment.
