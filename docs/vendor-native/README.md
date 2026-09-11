# Vendor background order alerts

Status: Supabase backend installed with sender DISABLED; Firebase sender credential
and Android build/device verification remain outstanding. See DEPLOYMENT.md.
Firebase project: `jride-notifications`. Android package: `com.jride.vendor`.
Web baseline: `b7d1db4747da19dd496325faf3626227bb022748`.

The existing foreground popup and sound rely on the WebView running. Android can
suspend a minimized WebView. This change registers the signed-in installation and
uses native Firebase data messages to post a high-importance Android notification
with the existing order sound. Tapping it opens Orders. The foreground topmost
popup remains the existing implementation.

Supabase owns the reminder schedule and reads live pending takeout bookings before
each send. The first order triggers dispatch; an enabled scheduler checks for due
work every five seconds. A successful send schedules the next reminder for 30
seconds later. Scheduling adds up to five seconds of jitter, with possible extra
network/FCM/Android delay. This is not a guarantee of exact 30-second delivery.
Accepted, declined, cancelled and expired orders stop qualifying. The original
five-minute acceptance window is never extended by a delayed message.

The Android source is delivered separately against the uploaded vendor baseline.
It includes Firebase resources only in the vendor flavor, runtime notification
permission, a notification status/settings button, session and event validation,
short notification expiry, and WorkManager registration retries. No persistent
foreground service or WebView keep-alive is used. Force-stop, disabled notification
permissions/channels, device power restrictions, mute and Do Not Disturb can block
or silence alerts. Background heads-up placement is controlled by Android.

## Authentication and data

The device route derives vendor identity from the existing signed HTTP-only vendor
session and checks active credentials. Client-supplied vendor identity is ignored.
A private installation secret prevents registration takeover and permits revocation
after cookie expiry. Registrations expire with the signed login session (currently
eight hours by default). Logout clears the browser cookie and revokes registration;
native logout also clears the local binding, so delayed messages are ignored.

The device table has RLS enabled and no anon/authenticated grants. Only service_role
can call its RPCs. The public worker-config wrapper is also service_role-only and
can read only two named Vault entries through a private function. Push data carries
count and binding information, with no customer names, phone numbers or order items.
An installation lease and event IDs limit duplicates; FCM delivery is not exactly-once.

## Activation order

1. Review and merge the web/API changes after the full Next.js build succeeds.
2. Apply `schema.sql` using the normal Supabase migration workflow. It starts disabled.
3. With action-time approval, create a dedicated notification sender service account
   in `jride-notifications`, give it only the FCM send permission required by Google,
   and store its JSON credential in Supabase Vault as
   `vendor_native_firebase_service_account`. Keep private keys out of app code,
   browser code, source control, logs and APKs. The uploaded `google-services.json`
   identifies the Android app; it is not a server credential.
4. Deploy `supabase/functions/vendor-native-alerts/index.ts` plus `core.ts` with
   `verify_jwt=false`. The handler enforces its own constant-time hook-secret check.
5. Apply `scheduler.sql`. It enables pg_net/pg_cron and creates a random
   `vendor_native_hook_secret` in Vault if absent. Verify the trigger and cron job.
6. Build and install the vendor APK using the matching local signing configuration.
   Sign in, allow notifications and enable sound/pop-on-screen. Confirm registration.
7. For a controlled device test, enable the single settings row and submit a test
   order. Verify foreground, minimized and locked-screen delivery, repeated sound,
   acceptance/cancellation/expiry, logout and account switch, denied permission,
   offline reconnect, token refresh and mute. Enable broader use only after these pass.

Activation: `update vendor_native_private.settings set enabled=true where id;`
Stop dispatch: `update vendor_native_private.settings set enabled=false where id;`
The scheduler checks this flag before issuing any request. Existing already-posted
notifications expire at their supplied deadline. No production migration, schedule,
server credential or sender activation was performed during the original source
preparation. The later disabled backend installation is recorded in DEPLOYMENT.md.

## Verification on 2026-09-11

| Check | Result |
| --- | --- |
| Sender payload/auth/expiry/failure behavior | 17 checks passed |
| Signed device registration/revocation | 11 checks passed |
| Foreground/native sound controller | 18 checks passed |
| SQL registration, pending filters, leases and privileges | 15 checks passed |
| Changed API and Edge Function TypeScript | Strict typecheck passed |
| Android XML and Firebase resource mapping | Passed static checks |
| Android Kotlin compilation / APK build | Blocked; dependency network approval cancelled |
| Live cron/Edge deployment, real FCM and physical phone sound | Not tested |

SQL checks ran with temporary booking/credential fixtures inside BEGIN/ROLLBACK;
no real orders or permanent native schema objects were changed. No result above
proves Android delivery or audible playback on a physical phone.

JavaScript checks: from the repository root, with Next.js dependencies plus esbuild
available, run `node tests/vendor-native/run.cjs`. Generated test outputs are ignored.
Typecheck: `tsc -p tests/vendor-native/tsconfig.json` using TypeScript 5.4.5.
`tests/vendor-native/dispatch.sql` contains the fixture assertions; its wrapper must
create temporary booking/credential tables and redirect the schema's two source
table references before applying the schema inside a rolled-back transaction.

The root Next.js config excludes only this Deno function and its scoped tests;
the function and API have their own strict check. No application dependency or lock
file changes are required for the web/backend code.
