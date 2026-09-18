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


test("LiveTrips driver list stays usable without a wide side-scroll layout", () => {
  const client = read("app/admin/livetrips/LiveTripsClient.tsx");

  assert(client.includes('viewMode === "drivers" ? "" : "xl:grid-cols-[1.05fr,0.95fr]"'));
  assert(client.includes('className="min-w-[900px] w-full text-sm"'));
  assert(!client.includes('className="min-w-[1280px] w-full text-sm"'));
  for (const label of [
    "Driver",
    "Vehicle",
    "Towns",
    "Coverage / Ride",
    "Status / Freshness",
    "Trip / Last Ping",
    "Map",
  ]) {
    assert(client.includes(">" + label + "</th>"), "missing compact driver column " + label);
  }
  assert(client.includes(">Driver Map</div>"));
  assert(client.includes("Live driver positions for the current town filter."));
  assert(client.includes('viewMode !== "drivers" ? ('));
  assert(client.includes("selectedDriverId={selectedDriverId}"));
  assert(client.includes("const driverMapRef = useRef<HTMLDivElement | null>(null)"));
  assert(client.includes("ref={driverMapRef}"));
  assert(client.includes('className="h-[520px] min-h-[420px] overflow-hidden rounded-lg border bg-white"'));
  assert(client.includes("driverMapRef.current?.scrollIntoView"));
});

test("overdue Takeout vendor-pending rows leave normal Dispatch and surface as problems", () => {
  const client = read("app/admin/livetrips/LiveTripsClient.tsx");

  assert(client.includes("TAKEOUT_VENDOR_PENDING_MAX_AGE_MS = 5 * 60 * 1000"));
  assert(client.includes("function isOverdueTakeoutVendorPending"));
  assert(client.includes('normStatus(t.service_type) !== "takeout"'));
  assert(client.includes('normStatus(t.status) !== "vendor_pending"'));
  assert(client.includes("isOverdueTakeoutVendorPending(t) ||"));
  assert(client.includes('return "VENDOR TIMEOUT OVERDUE"'));
  assert(client.includes("!isOverdueTakeoutVendorPending(t)"));
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

console.log("8 unified Dispatch Center regression groups passed.");
