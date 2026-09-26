const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
let passed = 0;

async function test(name, run) {
  await run();
  passed += 1;
  console.log("PASS " + name);
}

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics.filter(x => x.category === ts.DiagnosticCategory.Error).length, 0, file);
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: name => name in mocks ? mocks[name] : require(name),
    Buffer,
    Error,
    String,
    Number,
    Set,
    ...globals,
  }, { filename: file });
  return module.exports;
}

(async () => {
  await test("driver directions reject identity-only and generic text", () => {
    const { driverDirectionsError } = load("lib/agrimarket/farmer-profile-validation.ts");
    const base = {
      contactName: "Juan Farmer",
      vendorName: "Happy Farm",
      town: "Lamut",
      barangay: "Sanafe",
    };
    for (const directions of ["Happy Farm", "Juan Farmer", "Lamut", "Sanafe", "none", "house"]) {
      assert(driverDirectionsError({ ...base, directions }), directions);
    }
    assert.equal(driverDirectionsError({ ...base, directions: "Blue gate beside Sanafe barangay hall" }), null);
  });

  await test("profile route enforces useful directions before save RPC", () => {
    const source = read("app/api/agrimarket/producer/profile/route.ts");
    assert(source.includes("driverDirectionsError"));
    assert(source.includes("AGRIMARKET_PICKUP_DIRECTIONS_INVALID"));
    assert(source.indexOf("driverDirectionsError") < source.indexOf('agrimarket_farmer_save_profile_v4'));
  });

  await test("non-order farmer pages use compact status and alerts", () => {
    const workspace = read("app/agrimarket/producer/FarmerWorkspace.tsx");
    const store = read("app/agrimarket/producer/FarmerStoreStatus.tsx");
    const alerts = read("app/agrimarket/producer/FarmerOrderAlerts.tsx");
    assert(workspace.includes('compact={section !== "orders"}'));
    assert(workspace.includes('section === "profile"'));
    assert(store.includes("Pending JRide approval"));
    assert(store.includes("!store.ready"));
    assert(alerts.includes("compact && pending.length === 0 && !error"));
    assert(alerts.includes("{!compact && <details"));
  });

  await test("product page avoids duplicate empty-shelf actions", () => {
    const source = read("app/agrimarket/producer/products/page.tsx");
    assert(source.includes("products.length > 0 || showCreate"));
    assert(source.includes('["livestock", "meat"].includes(product.product_group)'));
    assert(source.includes("Add my first product"));
    assert(!source.includes('id="farm-details"'));
    assert(source.includes("View farm profile"));
  });

  await test("photo client uses adaptive downscaling and hard upload cap", () => {
    const source = read("app/agrimarket/producer/products/PhotoPicker.tsx");
    assert(source.includes("DIMENSION_STEPS"));
    assert(source.includes("QUALITY_STEPS"));
    assert(source.includes("TARGET_UPLOAD_BYTES"));
    assert(source.includes("HARD_UPLOAD_BYTES"));
    assert(source.includes('canvasBlob(canvas, "image/webp"'));
    assert(source.includes('canvasBlob(canvas, "image/jpeg"'));
  });

  await test("server photo normalization adapts until target size", async () => {
    let current = { maxSide: 0, quality: 0 };
    const sharp = () => ({
      metadata: async () => ({ format: "jpeg", pages: 1 }),
      rotate() { return this; },
      resize(maxSide) { current.maxSide = maxSide; return this; },
      webp({ quality }) { current.quality = quality; return this; },
      async toBuffer() {
        const size = current.maxSide === 1600 && current.quality >= 82
          ? 900 * 1024
          : current.maxSide === 1600 && current.quality >= 74
            ? 650 * 1024
            : 500 * 1024;
        return Buffer.alloc(size);
      },
    });
    const photo = load("lib/agrimarket/product-photo.ts", { sharp: { __esModule: true, default: sharp } });
    const file = {
      size: 500000,
      type: "image/jpeg",
      arrayBuffer: async () => Buffer.alloc(100).buffer,
    };
    const output = await photo.normalizeProductPhoto(file);
    assert(output.length <= 700 * 1024);
    assert.equal(current.maxSide, 1600);
    assert.equal(current.quality, 74);
  });

  await test("readiness cannot bypass useful pickup directions", () => {
    const storeApi = read("app/api/agrimarket/producer/store/route.ts");
    const adminApi = read("app/api/agrimarket/admin/verified-farmers/route.ts");
    assert(storeApi.includes("driverDirectionsError"));
    assert(storeApi.includes("directionsReady"));
    assert(adminApi.includes("AGRIMARKET_PICKUP_DIRECTIONS_INVALID"));
    assert(adminApi.includes("Correct the farmer pickup directions before approving readiness."));
  });

  await test("profile success notice is single-message and auto-hides", () => {
    const page = read("app/agrimarket/producer/profile/page.tsx");
    const notice = read("app/agrimarket/producer/ProfileSavedNotice.tsx");
    assert(page.includes('message: body.message || "Farm profile saved."'));
    assert(!page.includes('"Farm profile saved. Your farm/store name is locked. " +'));
    assert(notice.includes("7000"));
  });

  console.log("AgriMarket vendor UI/photo safety: " + passed + " groups passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
