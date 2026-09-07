import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { changeSchedule, effectiveSchedule, emptySchedule, type Driver, type Schedule } from "@/lib/operations-schedule";

import { operationsDriverRoster } from "@/lib/operations-driver-roster";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function approved() { return (process.env.JRIDE_DISPATCHER_EMAILS || process.env.DISPATCHER_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean); }
const EMPLOYEE_SCHEDULE_ACTIONS = new Set(["claim", "accept", "release", "coverage", "cancel_coverage", "rest", "unrest"]);
async function roster(db: ReturnType<typeof supabaseAdmin>): Promise<Driver[]> {
  const locations = await db.from("driver_locations").select("driver_id,home_town,updated_at").order("updated_at", { ascending: false }).limit(500);
  if (locations.error) throw new Error("Driver roster could not be loaded.");
  const ids = Array.from(new Set((locations.data || []).map(d => d.driver_id).filter(Boolean)));
  if (!ids.length) return [];
  const [drivers, profiles] = await Promise.all([
    db.from("drivers").select("id,driver_name,driver_status,roster_status").in("id", ids),
    db.from("driver_profiles").select("driver_id,full_name,municipality").in("driver_id", ids),
  ]);
  if (drivers.error || profiles.error) throw new Error("Driver roster could not be loaded.");
  return operationsDriverRoster(locations.data || [], drivers.data || [], profiles.data || []);
}
export async function GET(request: NextRequest) {
  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from("operations_schedule_state").select("version,state").eq("id", 1).single();
    if (error || !data) return json({ error: "Operations Schedule storage is not ready. Contact Admin." }, 503);
    const state = effectiveSchedule(data.state as Schedule);
    if (access.staff.role !== "admin" && !state.employees.some(e => e.email === access.staff.email)) return json({ version: data.version, onboarding: true, state: { ...emptySchedule(), employees: state.employees.filter(e => !e.email) }, actor: access.staff, approved: [], drivers: [], events: [], serverTime: new Date().toISOString() });
    const before = request.nextUrl.searchParams.get("before");
    let history = db.from("operations_schedule_events").select("id,version,actor,action,note,day,duty,created_at,changes").order("id", { ascending: false }).limit(40);
    if (before && /^\d+$/.test(before)) history = history.lt("id", before);
    const [events, drivers] = await Promise.all([history, roster(db)]);
    if (events.error) throw new Error("History could not be loaded.");
    return json({ ...data, state, actor: access.staff, approved: access.staff.role === "admin" ? approved() : [], drivers, events: events.data, serverTime: new Date().toISOString() });
  } catch { return json({ error: "Unable to load the shared schedule. Please retry." }, 503); }
}
export async function POST(request: NextRequest) {
  // Same-origin JSON only. Identity and authority always come from the staff session.
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return json({ error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON is required." }, 415);
  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: "Request is too large." }, 413);
    const input = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input) || !Number.isSafeInteger(input.version)) return json({ error: "Refresh the schedule before making a change." }, 400);
    const db = supabaseAdmin();
    const { data, error } = await db.from("operations_schedule_state").select("version,state").eq("id", 1).single();
    if (error || !data) return json({ error: "Schedule storage is unavailable." }, 503);
    if (data.version !== input.version) return json({ error: "The schedule changed. Refresh and try again." }, 409);

    const action = String(input.action || "");
    if (access.staff.role !== "admin" && EMPLOYEE_SCHEDULE_ACTIONS.has(action)) {
      const state = effectiveSchedule(data.state as Schedule);
      const employee = state.employees.find((item) => item.email === access.staff.email);
      if (!employee) return json({ error: "Choose your coordinator name before scheduling." }, 403);
      const latest = await db
        .from("operations_employee_locations")
        .select("id")
        .eq("employee_id", employee.id)
        .eq("staff_email", access.staff.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) return json({ error: "GPS verification is temporarily unavailable. Retry the location check." }, 503);
      if (!latest.data) return json({ error: "Allow the GPS location check before choosing or changing schedules." }, 428);
    }

    const result = changeSchedule(data.state as Schedule, access.staff, input, new Date(), approved(), input.action === "balance_teams" ? await roster(db) : []);
    const commit = await db.rpc("operations_schedule_commit_v1", { p_version: data.version, p_state: result.state, p_event: result.event });
    if (commit.error) return json({ error: "The change could not be saved. Refresh before trying again." }, 503);
    if (!commit.data) return json({ error: "Another person changed the schedule first. Refresh and try again." }, 409);
    return json({ ok: true, version: data.version + 1 });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid schedule request." }, 400); }
}
