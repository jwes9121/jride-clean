"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { meetingStatusLabel, type MeetingAsset, type MeetingView } from "@/lib/operations-meetings";

type ResponseBody = {
  actor?: { email: string; role: string; name: string };
  meetings?: MeetingView[];
  serverTime?: string;
  error?: string;
};

export default function MeetingRoomClient({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<MeetingView | null>(null);
  const [actor, setActor] = useState<ResponseBody["actor"]>();
  const [serverTime, setServerTime] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fitMode, setFitMode] = useState<"screen" | "width">("screen");
  const [zoom, setZoom] = useState(1);

  const admin = actor?.role === "admin";

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/operations-meetings?id=${encodeURIComponent(meetingId)}`, { cache: "no-store" });
      const body: ResponseBody = await response.json();
      if (!response.ok) throw new Error(body.error || "Meeting could not be loaded.");
      setMeeting(body.meetings?.[0] || null);
      setActor(body.actor);
      setServerTime(body.serverTime || "");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meeting could not be loaded.");
    }
  }, [meetingId]);

  const post = useCallback(async (action: string, extras: Record<string, unknown> = {}) => {
    const response = await fetch("/api/admin/operations-meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, meetingId, ...extras }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Meeting update failed.");
    return body;
  }, [meetingId]);

  useEffect(() => {
    let cancelled = false;

    async function enter() {
      await load();
      if (cancelled) return;
      try {
        await post("join");
      } catch {
        // Ended meetings remain readable, but a new attendance join is not recorded.
      }
      if (!cancelled) await load();
    }

    void enter();
    const poll = window.setInterval(load, 2500);
    const heartbeat = window.setInterval(() => {
      void post("heartbeat").catch(() => undefined);
    }, 20000);

    const leave = () => {
      void fetch("/api/admin/operations-meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave", meetingId }),
        keepalive: true,
      }).catch(() => undefined);
    };

    window.addEventListener("pagehide", leave);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [load, meetingId, post]);

  useEffect(() => {
    setZoom(1);
    setFitMode("screen");
  }, [meeting?.current_slide]);

  const currentAsset: MeetingAsset | null = useMemo(() => {
    if (!meeting?.assets?.length) return null;
    const index = Math.min(Math.max(0, meeting.current_slide || 0), meeting.assets.length - 1);
    return meeting.assets[index] || null;
  }, [meeting]);

  async function action(name: string, extras: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await post(name, extras);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meeting update failed.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !meeting) {
    return (
      <main className="min-h-screen bg-slate-950 p-5 text-white">
        <div className="mx-auto max-w-xl rounded-2xl border border-rose-500/40 bg-rose-950/50 p-5">
          <h1 className="text-xl font-bold">Meeting unavailable</h1>
          <p className="mt-2">{error}</p>
          <a className="mt-4 inline-block underline" href="/admin/operations-schedule/meetings">Back to Meetings</a>
        </div>
      </main>
    );
  }

  if (!meeting) return <main className="min-h-screen bg-slate-950 p-5 text-white">Loading meeting...</main>;

  const status = meetingStatusLabel(meeting);
  const index = meeting.assets.length ? Math.min(Math.max(0, meeting.current_slide || 0), meeting.assets.length - 1) : 0;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/10 bg-slate-900 px-4 py-3">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <a href="/admin/operations-schedule/meetings" className="text-xs font-semibold uppercase tracking-wide text-emerald-300">JRide Team Meetings</a>
            <h1 className="text-xl font-bold">{meeting.title}</h1>
            <p className="text-sm text-slate-300">{meeting.meeting_date} / {meeting.start_time.slice(0, 5)} - {meeting.end_time.slice(0, 5)} PHT / {status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {meeting.call_url ? <a href={meeting.call_url} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold">JOIN CALL</a> : null}
            <a href="/admin/operations-schedule" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold">Schedule</a>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[minmax(0,1fr),320px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className={["inline-flex rounded-full px-3 py-1 text-xs font-bold", status === "LIVE NOW" ? "bg-rose-600 text-white" : "bg-white/10 text-slate-200"].join(" ")}>{status}</span>
              {!admin && meeting.status === "live" ? <span className="ml-2 text-xs text-emerald-300">Following presenter automatically</span> : null}
            </div>
            {currentAsset?.kind === "image" ? (
              <div className="flex flex-wrap gap-2">
                <button className="rounded-lg border border-white/20 px-3 py-1.5 text-xs" onClick={() => setFitMode("screen")}>Fit screen</button>
                <button className="rounded-lg border border-white/20 px-3 py-1.5 text-xs" onClick={() => setFitMode("width")}>Fit width</button>
                <button className="rounded-lg border border-white/20 px-3 py-1.5 text-xs" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>-</button>
                <span className="px-1 py-1.5 text-xs">{Math.round(zoom * 100)}%</span>
                <button className="rounded-lg border border-white/20 px-3 py-1.5 text-xs" onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>+</button>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-[55vh] items-center justify-center overflow-auto rounded-2xl border border-white/10 bg-black p-3 sm:min-h-[68vh]">
            {!currentAsset ? (
              <div className="text-center text-slate-400"><p className="text-lg font-semibold">No presentation slides uploaded yet.</p><p className="mt-2 text-sm">The conference call can still continue.</p></div>
            ) : currentAsset.kind === "image" && currentAsset.signed_url ? (
              <img
                src={currentAsset.signed_url}
                alt={currentAsset.caption || currentAsset.original_name}
                style={fitMode === "width" ? { width: `${zoom * 100}%`, maxWidth: "none", height: "auto" } : { maxWidth: `${zoom * 100}%`, maxHeight: `${70 * zoom}vh`, width: "auto", height: "auto" }}
                className="block object-contain"
              />
            ) : currentAsset.kind === "pdf" && currentAsset.signed_url ? (
              <div className="flex min-h-[55vh] w-full flex-col gap-3">
                <iframe title={currentAsset.original_name} src={currentAsset.signed_url} className="min-h-[55vh] w-full flex-1 rounded-xl bg-white" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-amber-200">Phase 1 synchronizes a PDF as one deck item. Use screenshots or exported image slides for page-by-page following.</p>
                  <a href={currentAsset.signed_url} target="_blank" rel="noreferrer" className="rounded-lg border border-white/20 px-3 py-2 text-sm">Open PDF</a>
                </div>
              </div>
            ) : <p className="text-rose-300">This presentation file is temporarily unavailable.</p>}
          </div>

          <div className="mt-3 text-center">
            <div className="text-sm font-semibold">{meeting.assets.length ? `Slide ${index + 1} of ${meeting.assets.length}` : "No slides"}</div>
            {currentAsset?.caption ? <p className="mt-1 text-sm text-slate-300">{currentAsset.caption}</p> : null}
          </div>

          {admin ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900 p-3">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {meeting.status === "planned" ? <button disabled={busy} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold disabled:opacity-50" onClick={() => void action("start_meeting")}>Start meeting</button> : null}
                <button disabled={busy || !meeting.assets.length || index <= 0} className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold disabled:opacity-30" onClick={() => void action("set_slide", { index: index - 1 })}>Previous</button>
                <select aria-label="Jump to slide" value={meeting.assets.length ? index : 0} disabled={busy || !meeting.assets.length} className="rounded-xl border border-white/20 bg-slate-800 px-3 py-2 text-sm" onChange={(event) => void action("set_slide", { index: Number(event.target.value) })}>
                  {meeting.assets.length ? meeting.assets.map((asset, assetIndex) => <option key={asset.id} value={assetIndex}>{assetIndex + 1}. {asset.caption || asset.original_name}</option>) : <option value={0}>No slides</option>}
                </select>
                <button disabled={busy || !meeting.assets.length || index >= meeting.assets.length - 1} className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold disabled:opacity-30" onClick={() => void action("set_slide", { index: index + 1 })}>Next</button>
                {meeting.status === "live" ? <button disabled={busy} className="rounded-xl border border-rose-400 px-4 py-2 text-sm font-semibold text-rose-200" onClick={() => { if (window.confirm("End this meeting now?")) void action("end_meeting"); }}>End meeting</button> : null}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-white/10 bg-slate-900 p-4"><h2 className="font-bold">Agenda</h2><p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{meeting.agenda || "No agenda added."}</p></section>
          <section className="rounded-2xl border border-white/10 bg-slate-900 p-4"><h2 className="font-bold">Participants</h2><ul className="mt-2 space-y-1 text-sm text-slate-300">{(meeting.participant_names || []).map((name) => <li key={name}>{name}</li>)}</ul></section>
          {admin ? (
            <section className="rounded-2xl border border-white/10 bg-slate-900 p-4">
              <h2 className="font-bold">Attendance</h2>
              {!meeting.attendance.length ? <p className="mt-2 text-sm text-slate-400">Nobody has joined yet.</p> : (
                <ul className="mt-2 space-y-3 text-sm">
                  {meeting.attendance.map((attendance) => (
                    <li key={attendance.staff_email} className="rounded-xl bg-white/5 p-2">
                      <strong>{attendance.display_name || attendance.staff_email}</strong>
                      <div className="text-xs text-slate-400">Joined {new Date(attendance.joined_at).toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" })}{attendance.late_minutes ? ` / ${attendance.late_minutes} min late` : " / on time"}</div>
                      <div className="text-xs text-slate-400">{attendance.left_at ? "Left meeting" : "Present / recently active"}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          {meeting.notes ? <section className="rounded-2xl border border-white/10 bg-slate-900 p-4"><h2 className="font-bold">Meeting notes</h2><p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{meeting.notes}</p></section> : null}
          {error ? <section className="rounded-2xl border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</section> : null}
          {serverTime ? <p className="text-xs text-slate-500">Synced {serverTime}</p> : null}
        </aside>
      </div>
    </main>
  );
}
