const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function test(name, fn) {
  try {
    fn();
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name);
    throw error;
  }
}

test("Dispatch Center exposes all five service tabs from one URL", () => {
  const page = read("app/admin/livetrips/page.tsx");
  for (const label of [
    "Ride",
    "Takeout",
    "Advance Booking",
    "Errand",
    "AgriMarket",
  ]) {
    assert(page.includes('label: "' + label + '"'), "missing tab " + label);
  }
  assert(page.includes('"/admin/livetrips"'));
  assert(page.includes('"/admin/livetrips?service=" + tab.key'));
  assert(page.includes("<RideDispatchPanel"));
  assert(page.includes("<TakeoutDispatchPanel"));
  assert(page.includes("<AdvanceBookingDispatchPanel"));
  assert(page.includes("<AgrimarketDispatchGate"));
  assert(page.includes("<LiveTripsClient serviceFilter={liveTripsFilter}"));
});

test("LiveTrips service filter uses production booking service types", () => {
  const client = read("app/admin/livetrips/LiveTripsClient.tsx");
  assert(client.includes('serviceType === "motorcycle"'));
  assert(client.includes('serviceType === "tricycle"'));
  assert(client.includes('return serviceType === serviceFilter'));
  assert(client.includes('serviceFilter?: LiveTripsServiceFilter'));
  assert(client.includes("const serviceTrips = useMemo"));
});


test("Ride and Takeout tabs preserve their specialized dispatch controls", () => {
  const ride = read("app/admin/livetrips/components/RideDispatchPanel.tsx");
  const takeout = read("app/admin/livetrips/components/TakeoutDispatchPanel.tsx");

  assert(ride.includes('fetch("/api/admin/ride-dispatch?filter=all"'));
  assert(ride.includes('postJson("/api/dispatch/assign"'));
  assert(ride.includes("eligibleDrivers"));

  assert(takeout.includes('fetch("/api/admin/takeout-dispatch?filter=all"'));
  assert(takeout.includes('"/api/admin/takeout-dispatch/assign"'));
  assert(takeout.includes('"driver_unavailable"'));
  assert(takeout.includes("takeout_auto_dispatch_exhausted"));
  assert(takeout.includes("NEXT_ACTIONS"));
});

test("Advance Booking keeps its existing dispatcher API inside the unified center", () => {
  const panel = read(
    "app/admin/livetrips/components/AdvanceBookingDispatchPanel.tsx"
  );
  assert(panel.includes('fetch("/api/admin/advance-booking-dispatch'));
  assert(panel.includes("AdvanceBookingDispatchPanel"));
});

test("legacy admin dispatch routes redirect into the unified center", () => {
  const expected = {
    "app/admin/dispatch/page.tsx": 'redirect("/admin/livetrips")',
    "app/admin/ride-dispatch/page.tsx":
      'redirect("/admin/livetrips?service=ride")',
    "app/admin/takeout-dispatch/page.tsx":
      'redirect("/admin/livetrips?service=takeout")',
    "app/admin/advance-booking-dispatch/page.tsx":
      'redirect("/admin/livetrips?service=advance")',
  };

  for (const [file, redirectCall] of Object.entries(expected)) {
    const source = read(file);
    assert(source.includes(redirectCall), file + " missing redirect");
  }
});

test("staff navigation advertises one primary dispatch destination", () => {
  const directory = read("app/admin/control-center/AdminLinkDirectory.tsx");
  const controlCenter = read("app/admin/control-center/page.tsx");

  assert(directory.includes('title: "Dispatch Center"'));
  assert(directory.includes('href: "/admin/livetrips"'));
  for (const legacyHref of [
    "/admin/dispatch",
    "/admin/ride-dispatch",
    "/admin/takeout-dispatch",
    "/admin/advance-booking-dispatch",
  ]) {
    assert(
      !directory.includes('href: "' + legacyHref + '"'),
      "legacy directory link remains: " + legacyHref
    );
  }

  assert(controlCenter.includes('title="Dispatch Center"'));
  assert(controlCenter.includes('href="/admin/livetrips"'));
  assert(!controlCenter.includes('title="LiveTrips"'));
  assert(!controlCenter.includes('href="/admin/dispatch"'));
});

console.log("6 unified Dispatch Center regression groups passed.");
