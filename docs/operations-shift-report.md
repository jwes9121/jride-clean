# Duty officer shift report and driver follow-up

Open `/admin/operations-schedule`, then **Shift Report**. Primary is 10 AM to
3 PM and Evening is 3 PM to 7 PM, Philippine time. Admin can inspect dates;
coordinators can inspect their assigned shifts, accepted coverage, and shifts
where they have recorded actions.

## Monitoring trips

The assigned officer acknowledges the shift. All active Ride, Takeout and
Errand bookings are listed, including carry-over. The officer acknowledges
monitoring, records concerns and assistance, and explicitly hands over
unfinished trips. The incoming officer acknowledges them again. Temporary
coverage changes responsibility only when the requested replacement accepts.
Admin can take over with a recorded reason. After-hours assistance requires
Admin; the report does not extend an employee's scheduled hours.

Resolving an assistance issue never completes or cancels the booking. Outcomes
come from booking records. A driver offer expiring is counted separately from
a cancelled trip. The visible trip list refreshes every 15 seconds; this tab
does not provide background monitoring or automatically contact anyone.

## Offline driver follow-up

After prioritizing active trips, use the follow-up list to check drivers in
Lagawe, Hingyon, Banaue and Lamut. Town and existing team filters are available.
Reported offline, stale status, missing status and unknown status have separate
labels. Fresh online drivers and drivers with unfinished assigned bookings are
excluded, as are inactive, terminated, suspended, test and coordinator driver
identities. A low or locked wallet is flagged for assistance.

The officer makes the call/message/visit, then records the method, outcome and
note. Outcomes are No answer, Will go online, Unavailable today, Needs
assistance, and Reminder delivered. Unavailable today prevents another online
reminder for that date, including across shifts. Prior contact is visible so
the officer can decide whether another attempt is appropriate. The list
refreshes every 30 seconds while visible. Historical shifts retain contacts;
their offline lists are not reconstructed from current status.

Only the acknowledged monitor can save contact outcomes during live shift
hours. The server records the actual employee and timestamp. Request IDs
prevent duplicate retries; a changed monitor, intervening contact, or a driver
already coming online/on a trip is checked again when saving.

## Interpreting the stats

- New, completed and cancelled booking counts refer to events within the shift.
  Carry-in and carry-out use recorded state at the boundaries.
- Booking history began at the first migration rollout on September 9, 2026.
  Earlier shift-boundary and cancellation totals are explicitly unavailable or
  partial. They are not guessed from `updated_at`.
- Driver online minutes are clipped to the shift. Overlapping security
  exclusions are merged before subtraction. Missing telemetry is not proof
  of deliberate offline activity.
- Outreach shows recorded attempts, unique drivers contacted, and unique
  drivers with a later observed online minute before the shift ends. A minute
  bucket that began before the contact does not earn later-online credit.
  Later online activity does not establish that the contact caused it.
- Coordinator actions identify the actual actor. Trip completions and team
  driver activity are operational results, not automatic personal credit or
  an employee performance score.

## Validation

`node scripts/test-operations-shift-api.cjs` tests route authentication,
same-origin writes, server-owned identity, input validation, visible database
errors, Philippine shift boundaries and unique-driver totals.

`PGLITE_MODULE=/path/to/@electric-sql/pglite node scripts/test-operations-shift-db.cjs`
runs disposable PostgreSQL behavior tests for monitoring, handover, outreach,
idempotency, coverage ownership, security deductions, data boundaries and
database privileges. It does not accept a database connection string.

The migrations use service-only RPCs, RLS and the existing staff-session gate.
Outreach and officer action history cannot be updated, deleted or truncated by
the web application's service role, including with Supabase's default grants.
