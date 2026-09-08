import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DUTIES, effectiveSchedule, eventsOn, getSlot, localDate, restCount, weekStart, type Schedule } from "@/lib/operations-schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return json({ error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON is required." }, 415);

  const access = await requireStaff();
  if (!access.ok) return json({ error: access.error }, access.status);
  if (access.staff.role !== "admin") return json({ error: "Only Admin can adjust today's rest day." }, 403);

  try {
    const raw = await request.text();
    if (raw.length > 2000) return json({ error: "Request is too large." }, 413);
    const input = JSON.parse(raw) as { version?: unknown; employee?: unknown };
    if (!Number.isSafeInteger(input.version)) return json({ error: "Refresh the schedule before making this change." }, 400);

    const db = supabaseAdmin();
    const { data, error } = await db.from("operations_schedule_state").select("version,state").eq("id", 1).single();
    if (error || !data) return json({ error: "Schedule storage is unavailable." }, 503);
    if (data.version !== input.version) return json({ error: "The schedule changed. Refresh and try again." }, 409);

    const before = data.state as Schedule;
    const state = effectiveSchedule(JSON.parse(JSON.stringify(before)) as Schedule);
    const today = localDate(new Date());
    const employeeId = typeof input.employee === "string" ? input.employee.trim() : "";

    let note: string;
    if (!employeeId) {
      const previous = state.rests[today];
      if (!previous) return json({ ok: true, version: data.version, today, rest: null });
      const previousName = state.employees.find(employee => employee.id === previous)?.name || previous;
      delete state.rests[today];
      note = `Admin removed today's rest day from ${previousName}`;
    } else {
      const employee = state.employees.find(item => item.id === employeeId);
      if (!employee) return json({ error: "Choose Marcus, Kong or Bembol." }, 400);
      if (eventsOn(state, today).some(event => event.participants.includes(employee.id))) return json({ error: `${employee.name} is assigned to an event today.` }, 422);
      const duty = DUTIES.find(item => getSlot(state, today, item).owner === employee.id);
      if (duty) return json({ error: `${employee.name} already has the ${duty === "primary" ? "Primary" : "Evening"} duty today.` }, 422);
      if (state.rests[today] !== employee.id && restCount(state, employee.id, weekStart(today)) >= 2) return json({ error: `${employee.name} already has 2/2 rest days this week.` }, 422);
      state.rests[today] = employee.id;
      note = `Admin assigned today's rest day to ${employee.name}`;
    }

    Object.keys(state.months).forEach(month => {
      if (today.startsWith(month)) state.months[month] = false;
    });

    const event = {
      action: "admin_today_rest",
      actor: access.staff.email,
      actor_name: access.staff.name,
      note,
      day: today,
      duty: "",
      at: new Date().toISOString(),
      before,
      after: state,
    };
    const commit = await db.rpc("operations_schedule_commit_v1", { p_version: data.version, p_state: state, p_event: event });
    if (commit.error) return json({ error: "Today's rest day could not be saved." }, 503);
    if (!commit.data) return json({ error: "The schedule changed. Refresh and try again." }, 409);

    return json({ ok: true, version: data.version + 1, today, rest: state.rests[today] || null });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid rest-day request." }, 400);
  }
}
