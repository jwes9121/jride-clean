# Vendor notification deployment record

Date: 2026-09-11.
Project: JRide-prod, `gxaullwnxbkbjqbjotsr`.
Reviewed code: `972e2b4270130e013fd1bafb97099e30215765e6`, draft PR #39.

## Installed

- Migration `vendor_native_alerts_disabled_v1`: device table, private settings,
  signed-registration support RPCs, pending-order queries, claim/validate/finish RPCs.
- Edge Function `vendor-native-alerts`, version 1, ACTIVE as a deployed endpoint.
  ID: `3da26e20-8601-4375-a49e-75efc32125e0`.
  Its own hook-secret authentication is enforced; platform JWT checking is disabled.
- Migration `vendor_native_alerts_scheduler_disabled_v1`: pg_net, pg_cron,
  booking-change trigger and five-second due-work scheduler.
- Random hook credential stored in Supabase Vault as `vendor_native_hook_secret`.
  No secret value was printed, committed or added to an Android file.

The endpoint being ACTIVE does not mean sending is enabled.
`vendor_native_private.settings.enabled=false`.
There were zero registered devices and zero claimed devices at verification.
No real vendor notification was sent.

## Live verification

- Authorized request from pg_net using the Vault hook: HTTP 200,
  `{"enabled":false,"sent":0}`.
- Wrong 64-character hook: HTTP 401, `{"error":"UNAUTHORIZED"}`.
- Latest two scheduled executions succeeded.
- `anon` and `authenticated` cannot read device records or execute the worker
  configuration RPC; `service_role` can.
- Security advisors reported only the expected RLS-without-policy informational
  findings for these new tables. They deliberately have no end-user access;
  the server-only privileges were tested directly.
  [Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Prior source verification: 61 checks passed; strict TypeScript passed; Vercel
  preview for the reviewed code completed successfully.

## Remaining blockers

The user approved creation of a notification-only Firebase service account and
storage of its private key in Supabase Vault. The Google Cloud service-account
page displayed "Site Unavailable" in the browser, and one reload attempt timed
out. No service account or Firebase server key was created.
`vendor_native_firebase_service_account` does not exist in Vault.

Android dependency downloading was previously blocked by cancelled network
approval. No Kotlin/APK compilation or physical device background sound test has
been completed. The Android review archive remains the 11-file change package
for vendor 1.0.80, based on the user's most recent uploaded Android source.

The web changes remain in draft PR #39; they have not been merged into production.
Complete the Google credential, web release, Android build and controlled phone
test before enabling vendor notification sending. Do not advertise background
sound or exact 30-second delivery as working on the basis of these server checks.

## Stop / activation control

Sending remains disabled by the single settings row. For immediate stop:
`update vendor_native_private.settings set enabled=false where id;`
The scheduled function returns before sending any HTTP request while disabled.
