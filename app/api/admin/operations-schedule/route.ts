import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { changeSchedule, type Driver, type Schedule } from "@/lib/operations-schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function approved() { return (process.env.JRIDE_DISPATCHER_EMAILS || process.env.DISPATCHER_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean); }
async function roster(db: ReturnType<typeof supabaseAdmin>): Promise<Driver[]> {
  const [drivers, zones] = await Promise.all([
    db.from("drivers").select("id,driver_name,zone_id").or("roster_status.is.null,roster_status.eq.active").order("id").limit(10000),
    db.from("zones").select("id,zone_name"),
  ]);
  if (drivers.error || zones.error) throw new Error("Driver roster could not be loaded.");
  return (drivers.data || []).map(d => ({ id: d.id, name: d.driver_name || "Unnamed driver", town: zones.data?.find(z => z.id === d.zone_id)?.zone_name || "Unassigned town" }));
}
export async function GET(request: NextRequest) {
  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from("operations_schedule_state").select("version,state").eq("id", 1).single();
    if (error || !data) return json({ error: "Operations Schedule storage is not ready. Contact Admin." }, 503);
    const state = data.state as Schedule;
    if (access.staff.role !== "admin" && !state.employees.some(e => e.email === access.staff.email)) return json({ error: "Admin must link your approved account to a coordinator before you can view the schedule." }, 403);
    const before = request.nextUrl.searchParams.get("before");
    let history = db.from("operations_schedule_events").select("id,version,actor,action,note,day,duty,created_at,changes").order("id", { ascending: false }).limit(40);
    if (before && /^\d+$/.test(before)) history = history.lt("id", before);
    const [events, drivers] = await Promise.all([history, roster(db)]);
    if (events.error) throw new Error("History could not be loaded.");
    return json({ ...data, actor: access.staff, approved: access.staff.role === "admin" ? approved() : [], drivers, events: events.data, serverTime: new Date().toISOString() });
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
    const result = changeSchedule(data.state as Schedule, access.staff, input, new Date(), approved(), input.action === "balance_teams" ? await roster(db) : []);
    const commit = await db.rpc("operations_schedule_commit_v1", { p_version: data.version, p_state: result.state, p_event: result.event });
    if (commit.error) return json({ error: "The change could not be saved. Refresh before trying again." }, 503);
    if (!commit.data) return json({ error: "Another person changed the schedule first. Refresh and try again." }, 409);
    return json({ ok: true, version: data.version + 1 });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid schedule request." }, 400); }
}
