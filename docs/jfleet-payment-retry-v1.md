# JFleet original-payment retry hardening

Scope: owner confirmation of reservation, balance and full original-quotation payments. No change to commission, deposit, cancellation formulas, database migrations, driver assignment, or side-trip/add-on payment handlers.

## Protocol

The browser saves a frozen payment request in IndexedDB before issuing HTTP. The scope is authenticated owner + company + booking. A read/write transaction serializes competing tabs; generations prevent stale tabs resetting a newer form. A pending request is never removed because of a timeout, failed response, empty lookup or reload. No memory-only fallback is used when storage fails.

Only a server receipt matching the exact key, owner, company, booking, amount, kind, channel, reference and notes marks the saved request confirmed. A distinct additional payment requires the owner's explicit Record another payment action and opens an empty form with a new generation. A synchronous click guard prevents same-tab overlapping submissions.

The payments API no longer invents keys for keyless requests. The existing database payment function and unique key constraint remain authoritative. The API validates owner binding, checks the stored ledger before replaying, and verifies the ledger after a transaction. GET can recover an already committed payment even after the booking is closed. Receipt absence is not proof that an earlier request cannot still commit.

## Limits

This is per-browser recovery, not a universal identifier for a physical cash payment. Clearing browser data, changing profile or independently entering the same money on another device can lose the common key. Do not claim cross-device manual-payment deduplication. The UI explicitly warns against re-entry on another device while a result is unresolved. Add-on payment controls retain their existing implementation and need separate hardening. Original database idempotent replay can still emit more than one audit event; this change guarantees the payment-row behavior tested, not one event per HTTP request.

Owner records payment receipt; this does not move money. A canceled booking's historical confirmed-payment receipt does not assert its refund has been paid.

## Tests

- node tests/jfleet-payment-retry/run.cjs: pure contract, API guard and source checks; mocks only in this file.
- .github/workflows/jfleet-payment-retry.yml: locked app dependencies, existing regressions, full-project TypeScript, disposable unlinked Supabase Auth/PostgreSQL/PostgREST, real login/Next/browser tests, cleanup.
- tests/jfleet-payment-retry/integration.cjs drops requests before receipt or drops actual successful server responses after commit. It does not substitute successful business responses. Synthetic saved route geometry is used; no live routing or physical Android claim.

No production activation or migration is needed for this increment. Keep the PR staged until exact-commit checks and evidence are independently verified. Test reports must identify their commit and distinguish browser viewports from physical devices.

References: Indexed Database API 3.0 transaction scheduling (https://www.w3.org/TR/IndexedDB/); PostgreSQL 17 explicit locking (https://www.postgresql.org/docs/17/explicit-locking.html).
