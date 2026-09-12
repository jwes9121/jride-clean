# AgriMarket browser alerts

Scope: the AgriMarket producer workspace only. Existing farmer credentials authenticate the
new endpoint; this change does not change login, Takeout notifications, native Firebase,
driver sessions, order transitions, payments, or dispatch rules.

## Behaviour

- Poll the farmer's unexpired pending orders every 10 seconds, plus foreground return.
- Show an urgent review dialog. Explicitly enabled page audio repeats every 30 seconds
  while the page is visible and the feed is fresh. Accepted/expired orders stop alerts.
- Stop stale page alerts after 25 seconds without a successful refresh.
- Background notifications require the vendor's explicit permission and registration.
  An isolated worker controls `/agrimarket/producer`; the existing `/sw.js` is untouched.
- Delivery jobs are deduplicated per subscription/order and revalidated before sending.
  Push TTL never extends the order deadline. Browser and OS settings govern audible delivery.
- Background delivery sends one notification per order, not a repeating background ringtone.
- Test notifications create no orders or driver work. They become eligible after 15 seconds;
  the one-minute cron sends them. Allow up to 90 seconds and confirm delivery on the phone.
- A push-service acceptance is not proof that the phone displayed or sounded the notification.
- Registration lasts 30 days. A PIN reset invalidates the old registration. Use Refresh alert
  registration after signing in again. A browser cannot silently switch its subscription
  to another farm; disable its existing registration first.

## Verification

`npm run prebuild` includes the alert tests and existing vendor, driver-duty, and passenger
regressions. `npx tsc --noEmit` checks the application types.

`database.sql` is a rollback-only integration assertion suite for the existing named demo
farm. Run inside BEGIN/ROLLBACK after the migration. It does not send push notifications.
It verifies role restrictions, ownership, test rate limits, queue leases, credential
invalidation, and unsubscribe behaviour. Never run the suite outside its rollback wrapper.

`node tests/agrimarket-browser/fixture.cjs` serves an isolated localhost UI harness on
port 3184. It uses the actual component, CSS and audio with a fake API. No production
credentials or backend connection are used. The mock fixture deliberately disables push.
Use its buttons to check sound, popup review/snooze, expiry, and stale-feed handling.

## Deployment and rollback

1. Apply `20260912204428_agrimarket_browser_alerts_v1.sql`. Configuration starts disabled.
2. Generate a NEW VAPID key pair with the installed web-push package. Provision it only
   into `agrimarket_alerts_private.settings` through the authorized database administrator.
   Do not commit, log, or expose the private key; do not reuse native/Takeout credentials.
3. Verify the private schema and new subscription/job tables deny anon/authenticated access.
   New RPCs are service-role-only. Check Supabase security advisors after migration.
4. Deploy the tested branch, then promote through the normal Git review/build workflow.
   The existing Supabase server environment and `CRON_SECRET` must be configured.
5. Enable the private settings row, verify the scheduled worker returns 200, and perform
   the explicit sound/background test on the dummy vendor phone. Do not create real orders
   or dispatch a driver for this test.

To disable background sending safely, set `enabled=false` in the private settings row.
To roll back the application, restore the preceding deployment through the normal workflow.
Keep additive tables while investigating; no order data needs deletion. Foreground alerts
remain usable when background configuration is disabled.
