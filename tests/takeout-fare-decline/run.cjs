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

check("passenger UI exposes an explicit protected decline action", () => {
  assert(component.includes("Decline and cancel order"), "explicit decline button missing");
  assert(component.includes("cancel the entire Takeout order and release the driver"), "destructive confirmation warning missing");
  assert(component.includes('action: "decline"'), "decline action payload missing");
  assert(component.includes("expected_proposal: expectedFare(order)"), "UI does not bind decline to displayed proposal");
  assert(component.includes("jride_passenger_token"), "passenger bearer auth header source missing");
});

check("prebuild runs Takeout decline regression checks", () => {
  assert(pkg.includes("tests/takeout-fare-decline/run.cjs"), "Takeout decline regression suite is not in prebuild");
});

console.log(checks.length + " Takeout fare decline checks passed.");
