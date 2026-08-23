# Vendor Performance Baseline V1

## Public storefront

- Existing historical activity is retained but excluded from public performance metrics.
- Each vendor starts at `performance_metrics_started_at`.
- Before enough real activity exists, customers see `New on JRide | Performance tracking active`.
- Acceptance becomes public after at least 10 decided real orders and uses the latest 20 decisions.
- Survey score becomes public after at least 5 verified real completed-order ratings and uses the latest 20 ratings.
- Exact order counts remain admin-only.

## Vendor decision rules

Accepted:

- Vendor accepted before the deadline.
- A later customer, driver, or admin cancellation does not undo the accepted response.

Unaccepted:

- Vendor timeout.
- Vendor rejection before acceptance.

Pending:

- The vendor response window is still open.

## Test and dummy data

- Test passengers and bookings are excluded through explicit UUID registries.
- Operational records are never deleted by analytics exclusion.
- Partial name matching is prohibited because it can exclude legitimate users.

## Presence

- The vendor portal sends one heartbeat per minute while visible.
- `ONLINE` means the latest heartbeat is not older than 120 seconds.
- `OPEN BUT OFFLINE` means the store accepts orders but no fresh heartbeat exists.
- `CLOSED` means the vendor disabled new orders.

## Admin dashboard

Path: `/admin/vendors/behavior`

The dashboard shows:

- Offered, accepted, completed, accepted-not-completed, unaccepted, timed-out, rejected, and pending orders.
- Acceptance rate and average vendor response time.
- Current online state, last seen time, client, online hours, open hours, and open-but-offline hours.
- Today, rolling 7-day, and rolling 30-day totals.
- Complete-day, complete-week, and complete-month averages.
- Recent missed orders with placed date, missed date, reason, and amount.
- Explicit account and booking exclusion controls.
