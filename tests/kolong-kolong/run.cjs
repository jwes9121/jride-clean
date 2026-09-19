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

test("migration defines Kolong-Kolong as a 200 kg third vehicle", () => {
  const sql = read("supabase/migrations/20260919052000_kolong_kolong_vehicle_support_v1.sql");
  assert(sql.includes("Canonical database value: kolong_kolong"));
  assert(sql.includes("Kolong-Kolong"));
  assert(sql.includes("kolong_kolong_max_kg"));
  assert(sql.includes("default 200"));
  assert(sql.includes("'101_200'::text"));
  assert(sql.includes("AGRIMARKET_CARGO_OVER_200KG_UNSUPPORTED"));
  assert(sql.includes("jride_normalize_vehicle_type_v1"));
  assert(sql.includes("jride_vehicle_rank_v1"));
});

test("Errand accepts all three vehicle types and filters by cargo capacity", () => {
  const page = read("app/errands/page.tsx");
  const api = read("app/api/passenger/errand/book/route.ts");
  const assign = read("lib/errand/assignStage0V2.ts");

  assert(page.includes("Motorcycle / Tricycle / Kolong-Kolong"));
  assert(page.includes('["kolong_kolong", "Kolong-Kolong"]'));
  assert(page.includes("cargoKg > 200"));
  assert(page.includes("101-200 kg requires Kolong-Kolong"));

  assert(api.includes('"kolong_kolong" | "either"'));
  assert(api.includes('["motorcycle", "tricycle", "kolong_kolong", "either"]'));

  assert(assign.includes('return "kolong_kolong"'));
  assert(assign.includes("kolong_kolong_max_kg"));
  assert(assign.includes('vehicle === "kolong_kolong"'));
  assert(assign.includes("vehicleCapacityEligible"));
});

test("AgriMarket checkout and dispatch support Kolong-Kolong", () => {
  const order = read("app/api/agrimarket/_lib/order.ts");
  const dispatch = read("lib/agrimarket/dispatch.ts");
  const access = read("lib/agrimarket/pickupAccess.ts");
  const page = read("app/agrimarket/page.tsx");

  assert(order.includes('| "kolong_kolong"'));
  assert(order.includes("Kolong-Kolong"));
  assert(order.includes("vehicleRank(preferredVehicleType) < vehicleRank(requiredVehicleType)"));

  assert(dispatch.includes('"motorcycle" | "tricycle" | "kolong_kolong"'));
  assert(dispatch.includes('return "kolong_kolong"'));
  assert(dispatch.includes("vehicleRank(preferredVehicle) < vehicleRank(order.required_vehicle_type)"));

  assert(access.includes('vehicle === "tricycle" || vehicle === "kolong_kolong"'));

  assert(page.includes('<option value="kolong_kolong">Kolong-Kolong</option>'));
  assert(page.includes("Tricycle or Kolong-Kolong"));
});

test("AgriMarket farmer confirmation supports 101-200 kg", () => {
  const quote = read("app/api/agrimarket/quote/route.ts");
  const decision = read("app/api/agrimarket/producer/orders/decision/route.ts");
  const harvest = read("app/api/agrimarket/producer/orders/harvest/route.ts");
  const farmer = read("app/agrimarket/producer/page.tsx");

  assert(quote.includes("kolong_kolong_max_kg"));
  assert(quote.includes('vehicle: "Kolong-Kolong"'));
  assert(decision.includes('"101_200"'));
  assert(decision.includes("confirmedCargoWeightKg > 200"));
  assert(harvest.includes('"101_200"'));
  assert(harvest.includes("confirmedCargoWeightKg > 200"));
  assert(farmer.includes('["101_200", "101-200 kg - Kolong-Kolong"]'));
  assert(farmer.includes('max="200"'));
  assert(!farmer.includes('max="100"'));
});

test("farmer product setup can explicitly require Kolong-Kolong", () => {
  const productsApi = read("app/api/agrimarket/producer/products/route.ts");
  const productsPage = read("app/agrimarket/producer/products/page.tsx");
  const butchering = read("lib/agrimarket/butchering.ts");
  const butcheringForm = read("app/agrimarket/producer/products/ButcheringForm.tsx");

  assert(productsApi.includes('"kolong_kolong"'));
  assert(productsPage.includes('<option value="kolong_kolong">Kolong-Kolong</option>'));
  assert(butchering.includes('"kolong_kolong"'));
  assert(butcheringForm.includes('<option value="kolong_kolong">Kolong-Kolong</option>'));
});

test("Driver Locations legacy admin endpoint is not part of this change", () => {
  const source = read("app/api/driver_locations/route.ts");
  assert(!source.includes("kolong_kolong"));
});

console.log("6 Kolong-Kolong regression groups passed.");
