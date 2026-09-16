"use client";

import { useCallback, useEffect, useState } from "react";
import { meetingStartMs, type MeetingView } from "@/lib/operations-meetings";

export default function MeetingShell({ children }: { children: React.ReactNode }) {
  const [meeting, setMeeting] = useState<MeetingView | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/operations-meetings", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json();
      const rows: MeetingView[] = Array.isArray(body.meetings) ? body.meetings : [];
      const now = Date.parse(body.serverTime || new Date().toISOString());
      const live = rows.find((row) => row.status === "live");
      const upcoming = rows
        .filter((row) => row.status === "planned" && meetingStartMs(row) >= now - 15 * 60 * 1000)
        .sort((a, b) => meetingStartMs(a) - meetingStartMs(b))[0];
      setMeeting(live || upcoming || null);
    } catch {
      // Operations Schedule must stay usable even if Meetings is unavailable.
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 15000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <>
      <div className="border-b border-slate-200 bg-slate-950 px-4 py-2 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex flex-wrap gap-2 text-sm">
            <a className="rounded-lg border border-white/20 px-3 py-1.5 font-semibold" href="/admin/operations-schedule">
              Schedule
            </a>
            <a className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold" href="/admin/operations-schedule/meetings">
              Meetings
            </a>
          </nav>
          {meeting ? (
            <a
              href={`/admin/operations-schedule/meetings/${meeting.id}`}
              className={[
                "rounded-lg px-3 py-1.5 text-sm font-bold",
                meeting.status === "live" ? "bg-rose-600" : "bg-slate-800",
              ].join(" ")}
            >
              {meeting.status === "live" ? "LIVE NOW: " : "Upcoming: "}
              {meeting.title}
            </a>
          ) : (
            <span className="text-xs text-slate-400">No active team meeting</span>
          )}
        </div>
      </div>
      {children}
    </>
  );
}
