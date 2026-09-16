"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Employee, Schedule } from "@/lib/operations-schedule";
import { meetingStartMs, meetingStatusLabel, type MeetingView } from "@/lib/operations-meetings";

type MeetingResponse = {
  meetings?: MeetingView[];
  actor?: { email: string; role: string; name: string };
  serverTime?: string;
  error?: string;
};

type ScheduleResponse = {
  version: number;
  state: Schedule;
  actor: { email: string; role: string; name: string };
  error?: string;
};

async function meetingAction(action: string, extras: Record<string, unknown> = {}) {
  const response = await fetch("/api/admin/operations-meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extras }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Meeting request failed.");
  return body;
}

export default function MeetingsClient() {
  const [meetings, setMeetings] = useState<MeetingView[]>([]);
  const [actor, setActor] = useState<MeetingResponse["actor"]>();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scheduleVersion, setScheduleVersion] = useState<number | null>(null);
  const [today, setToday] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState("");
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [actionMeetingId, setActionMeetingId] = useState("");
  const [actionDraft, setActionDraft] = useState({ employee: "", title: "", instructions: "", due: "" });
  const [draft, setDraft] = useState({
    title: "",
    day: "",
    start: "20:00",
    end: "21:00",
    required: true,
    participants: [] as string[],
    agenda: "",
    callUrl: "",
  });

  const admin = actor?.role === "admin";

  const load = useCallback(async () => {
    try {
      const [meetingResponse, scheduleResponse] = await Promise.all([
        fetch("/api/admin/operations-meetings", { cache: "no-store" }),
        fetch("/api/admin/operations-schedule", { cache: "no-store" }),
      ]);
      const meetingBody: MeetingResponse = await meetingResponse.json();
      const scheduleBody: ScheduleResponse = await scheduleResponse.json();
      if (!meetingResponse.ok) throw new Error(meetingBody.error || "Meetings could not be loaded.");
      if (!scheduleResponse.ok) throw new Error(scheduleBody.error || "Employees could not be loaded.");

      const employeeRows = Array.isArray(scheduleBody.state?.employees) ? scheduleBody.state.employees : [];
      const phToday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(meetingBody.serverTime || Date.now()));

      setMeetings(Array.isArray(meetingBody.meetings) ? meetingBody.meetings : []);
      setActor(meetingBody.actor);
      setEmployees(employeeRows);
      setScheduleVersion(scheduleBody.version);
      setToday(phToday);
      setDraft((current) => ({
        ...current,
        day: current.day || phToday,
        participants: current.participants.length ? current.participants : employeeRows.map((employee) => employee.id),
      }));
      setActionDraft((current) => ({ ...current, due: current.due || phToday }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meetings could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const ordered = useMemo(
    () => meetings.slice().sort((a, b) => meetingStartMs(a) - meetingStartMs(b) || a.created_at.localeCompare(b.created_at)),
    [meetings]
  );

  async function run(action: string, extras: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await meetingAction(action, extras);
      setMessage("Meeting updated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meeting update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createMeeting(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await meetingAction("create_meeting", draft);
      setDraft({
        title: "",
        day: today,
        start: "20:00",
        end: "21:00",
        required: true,
        participants: employees.map((employee) => employee.id),
        agenda: "",
        callUrl: "",
      });
      setMessage("Meeting scheduled.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meeting could not be scheduled.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(meetingId: string, files: FileList | null) {
    if (!files?.length || uploading) return;
    setUploading(meetingId);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.append("meetingId", meetingId);
      Array.from(files).forEach((file) => form.append("files", file));
      const response = await fetch("/api/admin/operations-meetings/upload", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Presentation upload failed.");
      setMessage(`${files.length} presentation file${files.length === 1 ? "" : "s"} uploaded.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Presentation upload failed.");
    } finally {
      setUploading("");
    }
  }

  async function moveAsset(meeting: MeetingView, assetId: string, direction: -1 | 1) {
    const ids = meeting.assets.map((asset) => asset.id);
    const index = ids.indexOf(assetId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    await run("reorder_assets", { meetingId: meeting.id, assetIds: ids });
  }

  async function createActionItem(event: React.FormEvent) {
    event.preventDefault();
    if (scheduleVersion == null || !actionMeetingId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/operations-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_task",
          version: scheduleVersion,
          note: "",
          title: actionDraft.title,
          instructions: actionDraft.instructions,
          employee: actionDraft.employee,
          due: actionDraft.due,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Action item could not be created.");
      setActionMeetingId("");
      setActionDraft({ employee: "", title: "", instructions: "", due: today });
      setMessage("Action item added to employee Tasks.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action item could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5">
          <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">JRide Staff Operations</div>
          <h1 className="text-3xl font-bold">Team Meetings</h1>
          <p className="mt-1 text-sm text-slate-600">
            Admin presents from a PC. Employees can join the call and follow the live presentation on Android phones.
          </p>
        </header>

        {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        {message ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}

        {admin ? (
          <details className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" open={!meetings.length}>
            <summary className="cursor-pointer font-semibold">Schedule a meeting</summary>
            <form className="mt-4 grid gap-4" onSubmit={createMeeting}>
              <label className="grid gap-1 text-sm font-medium">
                Meeting title
                <input className="rounded-xl border border-slate-300 px-3 py-2" required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-sm font-medium">Date<input className="rounded-xl border border-slate-300 px-3 py-2" type="date" required min={today || undefined} value={draft.day} onChange={(event) => setDraft({ ...draft, day: event.target.value })} /></label>
                <label className="grid gap-1 text-sm font-medium">Start<input className="rounded-xl border border-slate-300 px-3 py-2" type="time" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
                <label className="grid gap-1 text-sm font-medium">End<input className="rounded-xl border border-slate-300 px-3 py-2" type="time" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
              </div>
              <label className="grid gap-1 text-sm font-medium">Conference call link<input className="rounded-xl border border-slate-300 px-3 py-2" type="url" maxLength={500} placeholder="https://meet.google.com/..." value={draft.callUrl} onChange={(event) => setDraft({ ...draft, callUrl: event.target.value })} /></label>
              <fieldset className="rounded-xl border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold">Employees attending</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {employees.map((employee) => (
                    <label key={employee.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={draft.participants.includes(employee.id)} onChange={(event) => setDraft({ ...draft, participants: event.target.checked ? [...draft.participants, employee.id] : draft.participants.filter((id) => id !== employee.id) })} />
                      {employee.name} / {employee.area}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft.required} onChange={(event) => setDraft({ ...draft, required: event.target.checked })} />Required meeting</label>
              <label className="grid gap-1 text-sm font-medium">Agenda<textarea className="rounded-xl border border-slate-300 px-3 py-2" rows={5} maxLength={4000} value={draft.agenda} onChange={(event) => setDraft({ ...draft, agenda: event.target.value })} placeholder={"1. Driver availability\n2. Trip monitoring\n3. Vendor concerns\n4. Action items"} /></label>
              <button className="w-fit rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={busy || !draft.title.trim() || !draft.participants.length}>Schedule meeting</button>
            </form>
          </details>
        ) : null}

        <div className="grid gap-4">
          {!ordered.length ? <div className="rounded-2xl border border-slate-200 bg-white p-5">No meetings scheduled yet.</div> : null}
          {ordered.map((meeting) => {
            const status = meetingStatusLabel(meeting);
            const notes = notesDrafts[meeting.id] ?? meeting.notes ?? "";
            return (
              <article key={meeting.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold">{meeting.title}</h2>
                    <p className="text-sm text-slate-600">{meeting.meeting_date} / {meeting.start_time.slice(0, 5)} - {meeting.end_time.slice(0, 5)} PHT / {meeting.required ? "Required" : "Optional"}</p>
                    <p className="mt-1 text-sm text-slate-600">Attending: {meeting.participant_names?.join(", ") || "No participants"}</p>
                  </div>
                  <span className={[
                    "w-fit rounded-full px-3 py-1 text-xs font-bold",
                    status === "LIVE NOW" ? "bg-rose-100 text-rose-700" : status === "Ended" ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700",
                  ].join(" ")}>{status}</span>
                </div>

                {meeting.agenda ? <div className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{meeting.agenda}</div> : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <a className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white" href={`/admin/operations-schedule/meetings/${meeting.id}`}>Open meeting room</a>
                  {meeting.call_url ? <a className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold" target="_blank" rel="noreferrer" href={meeting.call_url}>Join conference call</a> : null}
                  {admin && meeting.status === "planned" ? <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold" disabled={busy} onClick={() => void run("start_meeting", { meetingId: meeting.id })}>Start meeting</button> : null}
                  {admin && meeting.status === "live" ? <button className="rounded-xl border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700" disabled={busy} onClick={() => void run("end_meeting", { meetingId: meeting.id })}>End meeting</button> : null}
                  {admin && meeting.status === "planned" ? <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm" disabled={busy} onClick={() => { if (window.confirm("Cancel this meeting?")) void run("cancel_meeting", { meetingId: meeting.id }); }}>Cancel</button> : null}
                </div>

                {admin && !["ended", "cancelled"].includes(meeting.status) ? (
                  <section className="mt-4 rounded-xl border border-slate-200 p-3">
                    <h3 className="font-semibold">Presentation deck</h3>
                    <p className="text-xs text-slate-500">JPG, JPEG, PNG, WebP, or PDF. Up to 10 MB each. Image slides follow the presenter page by page. A PDF is one synchronized deck item in Phase 1.</p>
                    <input className="mt-2 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={uploading === meeting.id} onChange={(event) => { void uploadFiles(meeting.id, event.target.files); event.currentTarget.value = ""; }} />
                    {uploading === meeting.id ? <p className="mt-2 text-sm">Uploading presentation...</p> : null}
                    <div className="mt-3 grid gap-2">
                      {meeting.assets.map((asset, index) => (
                        <div key={asset.id} className="grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-[100px,1fr,auto] md:items-center">
                          <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-lg bg-white">
                            {asset.kind === "image" && asset.signed_url ? <img src={asset.signed_url} alt={asset.caption || asset.original_name} className="h-full w-full object-contain" /> : <strong className="text-xs">PDF</strong>}
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{index + 1}. {asset.original_name}</div>
                            <input className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm" maxLength={240} placeholder="Optional caption" value={captionDrafts[asset.id] ?? asset.caption} onChange={(event) => setCaptionDrafts({ ...captionDrafts, [asset.id]: event.target.value })} />
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <button className="rounded-lg border px-2 py-1 text-xs" disabled={busy || index === 0} onClick={() => void moveAsset(meeting, asset.id, -1)}>Up</button>
                            <button className="rounded-lg border px-2 py-1 text-xs" disabled={busy || index === meeting.assets.length - 1} onClick={() => void moveAsset(meeting, asset.id, 1)}>Down</button>
                            <button className="rounded-lg border px-2 py-1 text-xs" disabled={busy} onClick={() => void run("update_asset", { meetingId: meeting.id, assetId: asset.id, caption: captionDrafts[asset.id] ?? asset.caption })}>Save caption</button>
                            <button className="rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-700" disabled={busy} onClick={() => { if (window.confirm("Delete this presentation item?")) void run("delete_asset", { meetingId: meeting.id, assetId: asset.id }); }}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {admin ? (
                  <section className="mt-4 grid gap-2 rounded-xl border border-slate-200 p-3">
                    <label className="text-sm font-semibold">Meeting notes</label>
                    <textarea className="rounded-xl border border-slate-300 px-3 py-2 text-sm" rows={4} maxLength={4000} value={notes} onChange={(event) => setNotesDrafts({ ...notesDrafts, [meeting.id]: event.target.value })} />
                    <button className="w-fit rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold" disabled={busy} onClick={() => void run("save_notes", { meetingId: meeting.id, notes })}>Save notes</button>
                  </section>
                ) : meeting.notes ? <div className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{meeting.notes}</div> : null}

                {admin && meeting.attendance.length ? (
                  <details className="mt-4 rounded-xl border border-slate-200 p-3">
                    <summary className="cursor-pointer font-semibold">Attendance ({meeting.attendance.length})</summary>
                    <ul className="mt-2 space-y-1 text-sm">
                      {meeting.attendance.map((row) => <li key={row.staff_email}>{row.display_name || row.staff_email} - {row.late_minutes ? `${row.late_minutes} min late` : "on time"}{row.left_at ? " - left" : " - present"}</li>)}
                    </ul>
                  </details>
                ) : null}

                {admin ? (
                  actionMeetingId === meeting.id ? (
                    <form className="mt-4 grid gap-2 rounded-xl border border-slate-200 p-3" onSubmit={createActionItem}>
                      <h3 className="font-semibold">Create meeting action item</h3>
                      <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required value={actionDraft.employee} onChange={(event) => setActionDraft({ ...actionDraft, employee: event.target.value })}>
                        <option value="">Choose employee</option>
                        {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} / {employee.area}</option>)}
                      </select>
                      <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required maxLength={120} value={actionDraft.title} onChange={(event) => setActionDraft({ ...actionDraft, title: event.target.value })} />
                      <textarea className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required rows={3} maxLength={1500} placeholder="Instructions" value={actionDraft.instructions} onChange={(event) => setActionDraft({ ...actionDraft, instructions: event.target.value })} />
                      <input className="w-fit rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" required min={today || undefined} value={actionDraft.due} onChange={(event) => setActionDraft({ ...actionDraft, due: event.target.value })} />
                      <div className="flex gap-2"><button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white" disabled={busy}>Add to Tasks</button><button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setActionMeetingId("")}>Cancel</button></div>
                    </form>
                  ) : <button className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => { setActionMeetingId(meeting.id); setActionDraft({ employee: "", title: `Meeting follow-up: ${meeting.title}`, instructions: "", due: today }); }}>Create action item</button>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
