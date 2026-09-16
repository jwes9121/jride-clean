import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { effectiveSchedule, type Employee, type Schedule } from "@/lib/operations-schedule";
import {
  MEETING_BUCKET,
  isSafeMeetingCallUrl,
  meetingLateMinutes,
  type MeetingView,
} from "@/lib/operations-meetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function text(value: unknown, max = 10000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z"));
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
}

type StaffContext = {
  db: ReturnType<typeof supabaseAdmin>;
  role: string;
  email: string;
  name: string;
  admin: boolean;
  employee: Employee | null;
  state: Schedule;
};

async function staffContext(): Promise<
  { ok: true; value: StaffContext } | { ok: false; response: NextResponse }
> {
  const access = await requireStaff();
  if (!access.ok) return { ok: false, response: json({ error: access.error }, access.status) };

  const db = supabaseAdmin();
  const stateResult = await db
    .from("operations_schedule_state")
    .select("state")
    .eq("id", 1)
    .single();

  if (stateResult.error || !stateResult.data) {
    return { ok: false, response: json({ error: "Operations Schedule storage is unavailable." }, 503) };
  }

  const state = effectiveSchedule(stateResult.data.state as Schedule);
  const email = String(access.staff.email || "").trim().toLowerCase();
  const employee = state.employees.find((item) => item.email.toLowerCase() === email) || null;
  const admin = access.staff.role === "admin";

  if (!admin && !employee) {
    return { ok: false, response: json({ error: "Your employee identity is not linked to Operations Schedule." }, 403) };
  }

  return {
    ok: true,
    value: {
      db,
      role: access.staff.role,
      email,
      name: access.staff.name || email,
      admin,
      employee,
      state,
    },
  };
}

function canAccessMeeting(context: StaffContext, meeting: any) {
  if (context.admin) return true;
  if (!context.employee) return false;
  return Array.isArray(meeting.participant_ids) && meeting.participant_ids.includes(context.employee.id);
}

async function readMeeting(context: StaffContext, meetingId: string) {
  const result = await context.db
    .from("operations_meetings")
    .select("*")
    .eq("id", meetingId)
    .maybeSingle();

  if (result.error) throw new Error("Meeting could not be loaded.");
  if (!result.data) return null;
  if (!canAccessMeeting(context, result.data)) return null;
  return result.data;
}

async function meetingViews(context: StaffContext, onlyId?: string | null): Promise<MeetingView[]> {
  let query = context.db.from("operations_meetings").select("*");

  if (onlyId) {
    query = query.eq("id", onlyId);
  } else {
    query = query
      .order("meeting_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(100);
  }

  if (!context.admin && context.employee) {
    query = query.contains("participant_ids", [context.employee.id]);
  }

  const meetingsResult = await query;
  if (meetingsResult.error) throw new Error("Meetings could not be loaded.");

  const meetings = Array.isArray(meetingsResult.data) ? meetingsResult.data : [];
  if (!meetings.length) return [];

  const meetingIds = meetings.map((meeting) => String(meeting.id));
  const [assetsResult, attendanceResult] = await Promise.all([
    context.db
      .from("operations_meeting_assets")
      .select("*")
      .in("meeting_id", meetingIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    context.db
      .from("operations_meeting_attendance")
      .select("*")
      .in("meeting_id", meetingIds)
      .order("joined_at", { ascending: true }),
  ]);

  if (assetsResult.error) throw new Error("Meeting presentation could not be loaded.");
  if (attendanceResult.error) throw new Error("Meeting attendance could not be loaded.");

  const assets = Array.isArray(assetsResult.data) ? assetsResult.data : [];
  const signedAssets = await Promise.all(
    assets.map(async (asset) => {
      const signed = await context.db.storage
        .from(MEETING_BUCKET)
        .createSignedUrl(String(asset.storage_path), 3600);
      return { ...asset, signed_url: signed.error ? null : signed.data.signedUrl };
    })
  );

  const attendance = Array.isArray(attendanceResult.data) ? attendanceResult.data : [];
  const employeeNames = new Map(context.state.employees.map((employee) => [employee.id, employee.name]));

  return meetings.map((meeting) => ({
    ...meeting,
    participant_ids: Array.isArray(meeting.participant_ids) ? meeting.participant_ids : [],
    participant_names: (Array.isArray(meeting.participant_ids) ? meeting.participant_ids : []).map(
      (id: string) => employeeNames.get(id) || id
    ),
    assets: signedAssets.filter((asset) => asset.meeting_id === meeting.id),
    attendance: attendance
      .filter((row) => row.meeting_id === meeting.id)
      .map((row) => ({
        ...row,
        display_name: row.employee_id ? employeeNames.get(row.employee_id) || row.staff_email : row.staff_email,
      })),
  })) as MeetingView[];
}

export async function GET(request: NextRequest) {
  const contextResult = await staffContext();
  if (!contextResult.ok) return contextResult.response;

  try {
    const meetingId = request.nextUrl.searchParams.get("id");
    const meetings = await meetingViews(contextResult.value, meetingId);
    if (meetingId && !meetings.length) return json({ error: "Meeting not found." }, 404);

    return json({
      ok: true,
      actor: {
        email: contextResult.value.email,
        role: contextResult.value.role,
        name: contextResult.value.name,
      },
      employee_id: contextResult.value.employee?.id || null,
      meetings,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Meetings could not be loaded." }, 503);
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return json({ error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ error: "JSON is required." }, 415);
  }

  const contextResult = await staffContext();
  if (!contextResult.ok) return contextResult.response;
  const context = contextResult.value;

  try {
    const raw = await request.text();
    if (raw.length > 30000) return json({ error: "Request is too large." }, 413);
    const input = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json({ error: "Invalid meeting request." }, 400);
    }

    const action = text(input.action, 80);
    const adminOnly = new Set([
      "create_meeting",
      "start_meeting",
      "end_meeting",
      "cancel_meeting",
      "set_slide",
      "reorder_assets",
      "update_asset",
      "delete_asset",
      "save_notes",
    ]);

    if (adminOnly.has(action) && !context.admin) {
      return json({ error: "Only Admin can manage meetings." }, 403);
    }

    if (action === "create_meeting") {
      const title = text(input.title, 120);
      const day = text(input.day, 10);
      const start = text(input.start, 5);
      const end = text(input.end, 5);
      const agenda = text(input.agenda, 4000);
      const callUrl = text(input.callUrl, 500);
      const participants = uniqueStrings(input.participants);
      const validEmployees = new Set(context.state.employees.map((employee) => employee.id));

      if (!title) return json({ error: "Add a meeting title." }, 422);
      if (!validDay(day) || !validTime(start) || !validTime(end) || start >= end) {
        return json({ error: "Choose a valid meeting date and same-day time range." }, 422);
      }
      if (!participants.length || participants.some((id) => !validEmployees.has(id))) {
        return json({ error: "Choose at least one valid employee participant." }, 422);
      }
      if (!isSafeMeetingCallUrl(callUrl)) {
        return json({ error: "Use an HTTPS conference-call link." }, 422);
      }

      const insert = await context.db
        .from("operations_meetings")
        .insert({
          title,
          meeting_date: day,
          start_time: start,
          end_time: end,
          required: input.required !== false,
          participant_ids: participants,
          agenda,
          call_url: callUrl,
          created_by: context.email,
        })
        .select("id")
        .single();

      if (insert.error || !insert.data) return json({ error: "Meeting could not be created." }, 503);
      return json({ ok: true, id: insert.data.id });
    }

    const meetingId = text(input.meetingId, 80);
    if (!meetingId) return json({ error: "Meeting ID is required." }, 400);

    const meeting = await readMeeting(context, meetingId);
    if (!meeting) return json({ error: "Meeting not found." }, 404);

    if (action === "start_meeting") {
      if (!["planned", "live"].includes(meeting.status)) return json({ error: "Only an upcoming meeting can be started." }, 422);
      const update = await context.db
        .from("operations_meetings")
        .update({
          status: "live",
          started_at: meeting.started_at || new Date().toISOString(),
          ended_at: null,
          updated_at: new Date().toISOString(),
          version: Number(meeting.version || 0) + 1,
        })
        .eq("id", meetingId);
      if (update.error) return json({ error: "Meeting could not be started." }, 503);
      return json({ ok: true });
    }

    if (action === "end_meeting") {
      if (meeting.status !== "live") return json({ error: "Only a live meeting can be ended." }, 422);
      const now = new Date().toISOString();
      const update = await context.db
        .from("operations_meetings")
        .update({ status: "ended", ended_at: now, updated_at: now, version: Number(meeting.version || 0) + 1 })
        .eq("id", meetingId);
      if (update.error) return json({ error: "Meeting could not be ended." }, 503);
      return json({ ok: true });
    }

    if (action === "cancel_meeting") {
      if (["ended", "cancelled"].includes(meeting.status)) return json({ error: "This meeting is already closed." }, 422);
      const now = new Date().toISOString();
      const update = await context.db
        .from("operations_meetings")
        .update({ status: "cancelled", ended_at: now, updated_at: now, version: Number(meeting.version || 0) + 1 })
        .eq("id", meetingId);
      if (update.error) return json({ error: "Meeting could not be cancelled." }, 503);
      return json({ ok: true });
    }

    if (action === "set_slide") {
      const index = Number(input.index);
      if (!Number.isSafeInteger(index) || index < 0) return json({ error: "Choose a valid slide." }, 422);
      const assets = await context.db.from("operations_meeting_assets").select("id").eq("meeting_id", meetingId);
      if (assets.error) return json({ error: "Presentation could not be checked." }, 503);
      const count = assets.data?.length || 0;
      if (count === 0 && index !== 0) return json({ error: "No slides are uploaded yet." }, 422);
      if (count > 0 && index >= count) return json({ error: "That slide no longer exists." }, 409);
      const update = await context.db
        .from("operations_meetings")
        .update({ current_slide: index, updated_at: new Date().toISOString(), version: Number(meeting.version || 0) + 1 })
        .eq("id", meetingId);
      if (update.error) return json({ error: "Slide could not be changed." }, 503);
      return json({ ok: true });
    }

    if (action === "reorder_assets") {
      const assetIds = uniqueStrings(input.assetIds);
      const existing = await context.db
        .from("operations_meeting_assets")
        .select("id")
        .eq("meeting_id", meetingId)
        .order("sort_order", { ascending: true });
      if (existing.error) return json({ error: "Presentation could not be checked." }, 503);
      const existingIds = (existing.data || []).map((item) => String(item.id));
      if (assetIds.length !== existingIds.length || existingIds.some((id) => !assetIds.includes(id))) {
        return json({ error: "Refresh the presentation before reordering it." }, 409);
      }
      const updates = await Promise.all(
        assetIds.map((id, index) =>
          context.db.from("operations_meeting_assets").update({ sort_order: index }).eq("meeting_id", meetingId).eq("id", id)
        )
      );
      if (updates.some((result) => result.error)) return json({ error: "Presentation order could not be saved." }, 503);
      return json({ ok: true });
    }

    if (action === "update_asset") {
      const assetId = text(input.assetId, 80);
      const caption = text(input.caption, 240);
      const update = await context.db
        .from("operations_meeting_assets")
        .update({ caption })
        .eq("meeting_id", meetingId)
        .eq("id", assetId);
      if (update.error) return json({ error: "Slide caption could not be saved." }, 503);
      return json({ ok: true });
    }

    if (action === "delete_asset") {
      const assetId = text(input.assetId, 80);
      const assetResult = await context.db
        .from("operations_meeting_assets")
        .select("*")
        .eq("meeting_id", meetingId)
        .eq("id", assetId)
        .maybeSingle();
      if (assetResult.error || !assetResult.data) return json({ error: "Slide not found." }, 404);

      const removeRow = await context.db.from("operations_meeting_assets").delete().eq("id", assetId);
      if (removeRow.error) return json({ error: "Slide could not be deleted." }, 503);
      await context.db.storage.from(MEETING_BUCKET).remove([String(assetResult.data.storage_path)]);

      const remaining = await context.db
        .from("operations_meeting_assets")
        .select("id")
        .eq("meeting_id", meetingId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (!remaining.error) {
        await Promise.all(
          (remaining.data || []).map((asset, index) =>
            context.db.from("operations_meeting_assets").update({ sort_order: index }).eq("id", asset.id)
          )
        );
        const nextCount = remaining.data?.length || 0;
        const nextSlide = nextCount ? Math.min(Number(meeting.current_slide || 0), nextCount - 1) : 0;
        await context.db
          .from("operations_meetings")
          .update({ current_slide: nextSlide, updated_at: new Date().toISOString() })
          .eq("id", meetingId);
      }
      return json({ ok: true });
    }

    if (action === "save_notes") {
      const notes = text(input.notes, 4000);
      const update = await context.db
        .from("operations_meetings")
        .update({ notes, updated_at: new Date().toISOString(), version: Number(meeting.version || 0) + 1 })
        .eq("id", meetingId);
      if (update.error) return json({ error: "Meeting notes could not be saved." }, 503);
      return json({ ok: true });
    }

    if (!["join", "heartbeat", "leave"].includes(action)) return json({ error: "Unknown meeting action." }, 400);
    if (!canAccessMeeting(context, meeting)) return json({ error: "You are not a participant in this meeting." }, 403);

    const now = new Date();
    const existingAttendance = await context.db
      .from("operations_meeting_attendance")
      .select("*")
      .eq("meeting_id", meetingId)
      .eq("staff_email", context.email)
      .maybeSingle();
    if (existingAttendance.error) return json({ error: "Attendance could not be checked." }, 503);

    if (action === "join") {
      if (["ended", "cancelled"].includes(meeting.status)) return json({ error: "This meeting has already ended." }, 422);
      if (existingAttendance.data) {
        const update = await context.db
          .from("operations_meeting_attendance")
          .update({ last_seen_at: now.toISOString(), left_at: null })
          .eq("meeting_id", meetingId)
          .eq("staff_email", context.email);
        if (update.error) return json({ error: "Attendance could not be updated." }, 503);
      } else {
        const insert = await context.db.from("operations_meeting_attendance").insert({
          meeting_id: meetingId,
          employee_id: context.employee?.id || null,
          staff_email: context.email,
          joined_at: now.toISOString(),
          last_seen_at: now.toISOString(),
          left_at: null,
          late_minutes: meetingLateMinutes(
            { meeting_date: meeting.meeting_date, start_time: meeting.start_time } as Pick<MeetingView, "meeting_date" | "start_time">,
            now.getTime()
          ),
        });
        if (insert.error) return json({ error: "Attendance could not be recorded." }, 503);
      }
      return json({ ok: true });
    }

    if (!existingAttendance.data) return json({ error: "Join the meeting first." }, 409);
    const attendanceUpdate =
      action === "leave"
        ? { last_seen_at: now.toISOString(), left_at: now.toISOString() }
        : { last_seen_at: now.toISOString(), left_at: null };
    const update = await context.db
      .from("operations_meeting_attendance")
      .update(attendanceUpdate)
      .eq("meeting_id", meetingId)
      .eq("staff_email", context.email);
    if (update.error) return json({ error: "Attendance could not be updated." }, 503);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid meeting request." }, 400);
  }
}
