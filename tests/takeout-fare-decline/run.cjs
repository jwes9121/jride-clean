const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const routePath = path.join(root, "app/api/takeout/decline-fee/route.ts");
const componentPath = path.join(root, "app/takeout/TakeoutFareProposal.tsx");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260917195535_takeout_passenger_fare_decline_v1.sql"
);
const packagePath = path.join(root, "package.json");

const route = fs.readFileSync(routePath, "utf8");
const component = fs.readFileSync(componentPath, "utf8");
const migration = fs.readFileSync(migrationPath, "utf8");
const pkg = fs.readFileSync(packagePath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const checks = [];
function check(name, fn) {
  fn();
  checks.push(name);
  console.log("PASS", name);
}

check("decline endpoint requires authenticated passenger identity", () => {
  assert(route.includes("getTakeoutRequestUser(req, serviceSupabase)"), "missing authenticated request-user lookup");
  assert(route.includes("TAKEOUT_DECLINE_AUTH_REQUIRED"), "missing auth-required response");
  assert(!route.includes("body?.user_id") && !route.includes("body?.userId"), "request body must not choose the passenger identity");
});

check("native bearer plus device id is authoritative and validated", () => {
  const nativeAt = route.indexOf("if (token && deviceId)");
  const cookieAt = route.indexOf("createRouteHandlerClient({ cookies })");
  assert(nativeAt >= 0, "missing authoritative native bearer/device branch");
  assert(cookieAt > nativeAt, "browser cookie lookup must happen only after the native branch");
  const nativeBlock = route.slice(nativeAt, cookieAt);
  assert(nativeBlock.includes("admin.auth.getUser(token)"), "native bearer is not validated");
  assert(nativeBlock.includes("jride_passenger_validate_device_session"), "native device-session RPC is missing");
  assert(nativeBlock.includes("TAKEOUT_DECLINE_DEVICE_SESSION_VALIDATE_FAILED"), "device-session storage failure is not explicit");
  assert(nativeBlock.includes("ACCOUNT_ACTIVE_ON_ANOTHER_DEVICE"), "inactive native device session is not rejected");
  assert(nativeBlock.includes("return { ok: true, user }"), "valid native session does not return before browser fallbacks");
});

check("invalid native identity cannot fall back to browser auth", () => {
  const nativeAt = route.indexOf("if (token && deviceId)");
  const cookieAt = route.indexOf("createRouteHandlerClient({ cookies })");
  const nativeBlock = route.slice(nativeAt, cookieAt);
  const invalidBearerAt = nativeBlock.indexOf("bearer?.error || !user");
  const inactiveDeviceAt = nativeBlock.indexOf("!(deviceSession.data as any)?.ok");
  assert(invalidBearerAt >= 0 && nativeBlock.indexOf("status: 401", invalidBearerAt) > invalidBearerAt, "invalid native bearer must return 401");
  assert(inactiveDeviceAt >= 0 && nativeBlock.indexOf("status: 401", inactiveDeviceAt) > inactiveDeviceAt, "invalid native device session must return 401");
  assert(!nativeBlock.includes("createRouteHandlerClient") && !nativeBlock.includes("auth().catch"), "native branch must not reach browser cookie or NextAuth fallback");
});

check("browser cookie and legacy bearer-only decline sessions remain supported", () => {
  const cookieAt = route.indexOf("createRouteHandlerClient({ cookies })");
  const legacyBearerAt = route.indexOf("Legacy browser pages may still carry only the passenger bearer token");
  const nextAuthAt = route.indexOf("const nextSession = await auth().catch");
  assert(cookieAt >= 0, "browser cookie session support missing");
  assert(legacyBearerAt > cookieAt, "legacy browser bearer fallback missing or ordered incorrectly");
  assert(nextAuthAt > legacyBearerAt, "existing browser NextAuth fallback was not preserved");
});

check("decline endpoint requires the exact displayed proposal", () => {
  for (const token of ["expected?.proposed_at", "expected?.expires_at", "expected?.driver_id", "expected?.total"]) {
    assert(route.includes(token), "missing proposal identity token: " + token);
  }
  assert(route.includes("decline_takeout_fare_proposal_v1"), "endpoint does not call transactional decline RPC");
});

check("database RPC is locked to service role", () => {
  assert(migration.includes("security definer"), "RPC must be security definer");
  assert(migration.includes("from public, anon, authenticated"), "RPC execute permission is not revoked from client roles");
  assert(migration.includes("to service_role"), "service_role execute grant missing");
});

check("database RPC is row-locked and exact-proposal guarded", () => {
  assert(migration.includes("for update;"), "booking row is not locked");
  for (const token of [
    "takeout_fee_proposed_at = p_expected_proposed_at",
    "takeout_fee_expires_at = p_expected_expires_at",
    "takeout_total_payable = p_expected_total",
    "takeout_fee_proposed_by_driver_id = p_expected_driver_id",
    "assigned_driver_id = p_expected_driver_id",
  ]) {
    assert(migration.includes(token), "missing CAS guard: " + token);
  }
  assert(migration.includes("takeout_fee_proposed_at + interval '5 minutes'"), "five-minute passenger deadline guard missing");
});

check("successful decline terminally cancels and releases the driver without reassignment", () => {
  for (const token of [
    "status = 'cancelled'",
    "vendor_status = 'cancelled'",
    "customer_status = 'cancelled'",
    "driver_status = 'cancelled'",
    "takeout_pricing_status = 'passenger_declined'",
    "ride_reassignment_pending = false",
    "driver_id = null",
    "assigned_driver_id = null",
    "last_expired_driver_id = p_expected_driver_id",
  ]) {
    assert(migration.includes(token), "missing terminal decline behavior: " + token);
  }
});

check("decline notification and lifecycle are transactional and no-penalty", () => {
  const notificationAt = migration.indexOf("insert into public.driver_notifications");
  const lifecycleAt = migration.indexOf("record_booking_lifecycle_event");
  const returnAt = migration.lastIndexOf("return jsonb_build_object");
  assert(notificationAt > 0 && lifecycleAt > notificationAt && returnAt > lifecycleAt, "notification/lifecycle must be inside the RPC transaction");
  assert(migration.includes("'fare_declined'"), "driver notification type missing");
  assert(migration.includes("'fare_response_declined'"), "decline lifecycle event missing");
  assert(migration.includes("'driver_penalty', false"), "no-driver-penalty metadata missing");
  assert(migration.includes("'reassign', false"), "no-reassignment metadata missing");
});

check("retry after the same successful decline is idempotent", () => {
  const idempotentAt = migration.indexOf("'already_declined'");
  const notificationAt = migration.indexOf("insert into public.driver_notifications");
  assert(idempotentAt > 0 && idempotentAt < notificationAt, "idempotent terminal return must happen before notification insert");
});

check("passenger UI sends bearer and native device identity for decline", () => {
  assert(component.includes("Decline and cancel order"), "explicit decline button missing");
  assert(component.includes("cancel the entire Takeout order and release the driver"), "destructive confirmation warning missing");
  assert(component.includes('action: "decline"'), "decline action payload missing");
  assert(component.includes("expected_proposal: expectedFare(order)"), "UI does not bind decline to displayed proposal");
  assert(component.includes("jride_passenger_token"), "passenger bearer auth header source missing");
  assert(component.includes("jride_native_device_id"), "native passenger device id source missing");
  assert(component.includes('headers["x-device-id"]'), "native passenger device header missing");
});

check("prebuild runs Takeout decline regression checks", () => {
  assert(pkg.includes("tests/takeout-fare-decline/run.cjs"), "Takeout decline regression suite is not in prebuild");
});

console.log(checks.length + " Takeout fare decline checks passed.");
