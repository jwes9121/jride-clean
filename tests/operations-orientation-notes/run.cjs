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

test("Operations Schedule exposes Orientation Notes for staff", () => {
  const page = read("app/admin/operations-schedule/page.tsx");
  assert(page.includes('import OrientationNotesPanel from "./OrientationNotesPanel"'));
  assert(page.includes('"orientation-notes"'));
  assert(page.includes('"Orientation Notes"'));
  assert(page.includes("<OrientationNotesPanel admin={!!admin}"));
});

test("Orientation Notes supports driver, vendor and Agri Vendor cheat sheets", () => {
  const panel = read("app/admin/operations-schedule/OrientationNotesPanel.tsx");
  for (const audience of ["general", "drivers", "vendors", "agri_vendors"]) {
    assert(panel.includes('value="' + audience + '"'), "missing audience " + audience);
  }
  assert(panel.includes("Copy cheat sheet"));
  assert(panel.includes("Visible to employees"));
  assert(panel.includes("12,000 characters"));
});

test("Orientation Notes API is admin-write and approved-staff read", () => {
  const api = read("app/api/admin/operations-orientation-notes/route.ts");
  assert(api.includes("requireStaff()"));
  assert(api.includes("operations_schedule_state"));
  assert(api.includes("effectiveSchedule"));
  assert(api.includes("adminOnly"));
  assert(api.includes('access.staff.role === "admin"'));
  assert(api.includes('error: "FORBIDDEN"'));
  assert(api.includes("export async function GET"));
  assert(api.includes("export async function POST"));
  assert(api.includes("export async function PATCH"));
  assert(api.includes("export async function DELETE"));
});

test("Orientation Notes table is RLS protected and not browser-readable", () => {
  const migration = read(
    "supabase/migrations/20260918212229_operations_orientation_notes_v1.sql"
  );
  assert(migration.includes("enable row level security"));
  assert(
    migration.includes(
      "revoke all on table public.operations_orientation_notes from anon, authenticated"
    )
  );
  assert(migration.includes("agri_vendors"));
  assert(migration.includes("char_length(trim(content)) between 1 and 12000"));
});

console.log("4 Operations Orientation Notes regression groups passed.");
