# Vendor notification deployment record

Date: 2026-09-11.
Project: JRide-prod, `gxaullwnxbkbjqbjotsr`.
Reviewed application code: `972e2b4270130e013fd1bafb97099e30215765e6`, draft PR #39.

## Installed

- Migration `vendor_native_alerts_disabled_v1`: device table, private settings,
  signed-registration support RPCs, pending-order queries, claim/validate/finish RPCs.
- Edge Function `vendor-native-alerts`, version 1, ACTIVE as a deployed endpoint.
  ID: `3da26e20-8601-4375-a49e-75efc32125e0`.
  The handler enforces its own hook-secret authentication.
- Migration `vendor_native_alerts_scheduler_disabled_v1`: pg_net, pg_cron,
  booking-change trigger and five-second due-work scheduler.
- Random hook credential in Supabase Vault as `vendor_native_hook_secret`.
- User-supplied Firebase service-account credential stored in Vault as
  `vendor_native_firebase_service_account`. This is the existing default Firebase
  service account for `jride-notifications`, not a newly created dedicated account.
  No IAM roles were changed. The sender requests only the `firebase.messaging`
  OAuth scope. The private key is not part of this repository or the Android package.

The endpoint being ACTIVE does not mean sending is enabled.
`vendor_native_private.settings.enabled=false`.
There were zero registered devices at verification. No real notification was sent.

## Verification

- Uploaded credential parsed as a service account for the correct Firebase project.
  The PKCS#8 RSA private key parsed successfully and meets a 2048-bit minimum.
- A metadata-only query confirmed that the deployed worker-config RPC retrieves the
  expected project/account and private key from Vault. Sending remains disabled.
- `anon` and `authenticated` cannot execute the worker-config RPC or read Vault's
  decrypted secrets. No client privileges were added.
- Earlier authorized pg_net request to the deployed Edge Function: HTTP 200,
  `{"enabled":false,"sent":0}`. Wrong hook: HTTP 401.
- Earlier scheduler runs succeeded.
- Native-object security advisors report only intentional RLS-without-policy
  informational findings for server-only device/settings tables.
  [Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Prior source verification: 61 checks and strict TypeScript passed.
- Vercel reports a successful preview for `d873f1a724ec26eeb14955cc78eee90ed0c960dc`.

## Remaining work

The direct Google OAuth/FCM validation attempt was blocked: network approval was
cancelled before a decision was returned. No OAuth or FCM success was observed.
A local test of the uploaded key must request a messaging-scoped OAuth token and
call FCM with `validate_only=true`; no message should be delivered by that check.
This tests messaging authorization, not the account's complete IAM role inventory.

Android dependency downloading was also previously blocked by cancelled network
approval. Kotlin/APK compilation and physical-device background sound remain
unverified. The Android review archive contains the same 11 native source files
for vendor 1.0.80, based on the latest uploaded source. Respect the user's manual,
one-change-at-a-time Android workflow; no automatic patch/build script is included.

The web/API changes remain in draft PR #39 and have not been merged into production.
Complete Firebase authorization, web release, Android build and a controlled phone
test before broad activation. Do not claim background audio or exact 30-second
delivery works from configuration/static checks alone.

## Stop / activation control

For immediate stop:
`update vendor_native_private.settings set enabled=false where id;`
The scheduled function returns before sending HTTP requests while disabled.
