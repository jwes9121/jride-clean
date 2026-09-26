const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../../lib/agrimarket/dispatchWait.ts");
const moduleRef = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(code, { module: moduleRef, exports: moduleRef.exports, Date, Number, String }, { filename });
const { dispatchWaitCode, customerDispatchWait, dispatchAttention } = moduleRef.exports;

assert.equal(dispatchWaitCode({ ok: true, offered: false, error: "NO_DRIVER_WITHIN_AGRIMARKET_APPROACH_LIMIT" }), "outside_pickup_range");
assert.equal(dispatchWaitCode({ ok: true, offered: false, error: "ROAD_DISTANCE_UNAVAILABLE" }), "route_unavailable");
assert.equal(dispatchWaitCode({ ok: true, offered: false, error: "NO_APPROVED_AGRIMARKET_DRIVER_AVAILABLE" }), "no_approved_driver");
assert.equal(dispatchWaitCode({ ok: true, offered: true }), null);
assert.equal(dispatchWaitCode({ ok: false, error: "AGRIMARKET_DRIVER_LOCATION_READ_FAILED" }), "search_unavailable");

const now = Date.parse("2026-09-26T04:00:00+08:00");
const waiting = { status: "ready_for_dispatch", vehicle: "tricycle", code: "outside_pickup_range",
  checkedVehicle: "tricycle", checkedAt: new Date(now - 60_000).toISOString(), now };
assert.match(customerDispatchWait(waiting).message, /10 km road pickup limit/);
assert.equal(customerDispatchWait({ ...waiting, checkedVehicle: "motorcycle" }), null);
assert.equal(customerDispatchWait({ ...waiting, checkedAt: new Date(now - 4 * 60_000).toISOString() }), null);
assert.equal(customerDispatchWait({ ...waiting, status: "driver_assigned" }), null);
assert.equal(customerDispatchWait({ ...waiting, code: "route_unavailable" }).message.includes("No eligible"), false);
assert.equal(customerDispatchWait({ ...waiting, code: "constructor" }), null);

const justBeforeAlert = { ...waiting, readyAt: new Date(now - 15 * 60_000 + 1000).toISOString() };
assert.equal(dispatchAttention(justBeforeAlert), null);
assert.doesNotMatch(customerDispatchWait(justBeforeAlert).message, /staff attention/);
const dutyAlert = { ...waiting, readyAt: new Date(now - 15 * 60_000).toISOString() };
assert.equal(dispatchAttention(dutyAlert).level, "duty_alert");
assert.equal(dispatchAttention(dutyAlert).waiting_minutes, 15);
assert.match(customerDispatchWait(dutyAlert).message, /staff attention/);
const review = { ...waiting, readyAt: new Date(now - 30 * 60_000).toISOString() };
assert.equal(dispatchAttention(review).level, "review_required");
assert.match(customerDispatchWait(review).message, /staff review/);
assert(customerDispatchWait(review).message.length <= 360);
assert.equal(dispatchAttention({ ...review, assignedDriverId: "assigned" }), null);
assert.equal(dispatchAttention({ ...review, checkedVehicle: "motorcycle" }), null);
assert.equal(dispatchAttention({ ...review, status: "awaiting_harvest" }), null);
assert.equal(dispatchAttention({ ...review, readyAt: new Date(now + 10_000).toISOString() }), null);
const stale = { ...review, checkedAt: new Date(now - 4 * 60_000).toISOString() };
assert.equal(dispatchAttention(stale).level, "review_required");
assert.match(customerDispatchWait(stale).message, /No recent driver search result/);
assert.doesNotMatch(customerDispatchWait(stale).message, /10 km/);
assert.equal(dispatchAttention({ ...review, code: null }), null);
console.log("PASS: driver wait reason, 15/30 minute attention, stale-search recovery, assignment and vehicle guards");
