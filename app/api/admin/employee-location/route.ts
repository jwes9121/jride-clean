import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ScheduleEmployee = {
  id: string;
  name: string;
  area: string;
  email: string;
};

type LocationRow = {
  employee_id: string;
  staff_email: string;
  staff_name: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  device_captured_at: string | null;
  created_at: string;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function scheduleEmployees(state: unknown): ScheduleEmployee[] {
  if (!state || typeof state !== "object") return [];
  const employees = (state as { employees?: unknown }).employees;
  if (!Array.isArray(employees)) return [];
  return employees
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    .map((value) => ({
      id: String(value.id || "").trim(),
      name: String(value.name || "").trim(),
      area: String(value.area || "").trim(),
      email: String(value.email || "").trim().toLowerCase(),
    }))
    .filter((employee) => employee.id && employee.name);
}

async function loadEmployees() {
  const db = supabaseAdmin();
  const schedule = await db
    .from("operations_schedule_state")
    .select("state")
    .eq("id", 1)
    .single();
  if (schedule.error || !schedule.data) throw new Error("Schedule storage is unavailable.");
  return { db, employees: scheduleEmployees(schedule.data.state) };
}

export async function GET() {
  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);

  try {
    const { db, employees } = await loadEmployees();
    const current = employees.find((employee) => employee.email === access.staff.email);

    if (access.staff.role !== "admin") {
      if (!current) {
        return json({
          captureAllowed: false,
          reason: "Coordinator identity is not linked yet.",
        });
      }
      const latest = await db
        .from("operations_employee_locations")
        .select("latitude,longitude,accuracy_m,device_captured_at,created_at")
        .eq("employee_id", current.id)
        .eq("staff_email", access.staff.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) throw new Error("Location status could not be loaded.");
      return json({
        captureAllowed: true,
        employee: { id: current.id, name: current.name, area: current.area },
        latest: latest.data || null,
      });
    }

    const recent = await db
      .from("operations_employee_locations")
      .select("employee_id,staff_email,staff_name,latitude,longitude,accuracy_m,device_captured_at,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (recent.error) throw new Error("Location readings could not be loaded.");

    const latestByEmployee = new Map<string, LocationRow>();
    for (const row of (recent.data || []) as LocationRow[]) {
      if (!latestByEmployee.has(row.employee_id)) latestByEmployee.set(row.employee_id, row);
    }

    return json({
      captureAllowed: false,
      employees: employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        area: employee.area,
        email: employee.email,
        latest: latestByEmployee.get(employee.id) || null,
      })),
      serverTime: new Date().toISOString(),
    });
  } catch {
    return json({ error: "Unable to load employee GPS test data." }, 503);
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return json({ error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON is required." }, 415);

  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);
  if (access.staff.role === "admin") return json({ ok: true, skipped: "admin" });

  try {
    const raw = await request.text();
    if (raw.length > 4000) return json({ error: "Request is too large." }, 413);
    const input = JSON.parse(raw) as Record<string, unknown>;
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    const accuracy = Number(input.accuracy);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return json({ error: "Invalid latitude." }, 400);
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return json({ error: "Invalid longitude." }, 400);
    if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 100000) return json({ error: "Invalid GPS accuracy." }, 400);

    let deviceCapturedAt: string | null = null;
    if (typeof input.deviceCapturedAt === "string" && input.deviceCapturedAt) {
      const parsed = Date.parse(input.deviceCapturedAt);
      if (Number.isFinite(parsed)) deviceCapturedAt = new Date(parsed).toISOString();
    }

    const { db, employees } = await loadEmployees();
    const employee = employees.find((item) => item.email === access.staff.email);
    if (!employee) return json({ error: "Coordinator identity is not linked yet." }, 403);

    const saved = await db
      .from("operations_employee_locations")
      .insert({
        employee_id: employee.id,
        staff_email: access.staff.email,
        staff_name: employee.name,
        latitude,
        longitude,
        accuracy_m: accuracy,
        device_captured_at: deviceCapturedAt,
      })
      .select("latitude,longitude,accuracy_m,device_captured_at,created_at")
      .single();
    if (saved.error || !saved.data) throw new Error("Location reading could not be saved.");

    return json({ ok: true, employee: employee.name, reading: saved.data });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid GPS test request." }, 400);
  }
}
