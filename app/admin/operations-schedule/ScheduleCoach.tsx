"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DUTIES, addDays, getSlot, localDate, monthDays, weekStart, type Duty, type Schedule } from "@/lib/operations-schedule";
import { DUTY_LABELS, WEEKLY_REST_TARGET, weeklyDutySummary, weeklyRestCount } from "@/lib/operations-schedule-guidance";

type Actor = { email: string; role: string; name: string };
type Data = { version: number; state: Schedule; actor: Actor; serverTime: string; onboarding?: boolean };
type Popup = { title: string; body: string } | null;

function displayDay(day: string) {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function planningMonth(data: Data) {
  const current = localDate(new Date(data.serverTime)).slice(0, 7);
  const open = Object.keys(data.state.months).filter((month) => month >= current && data.state.months[month] === false).sort();
  return open.at(-1) || current;
}

function relevantWeeks(data: Data) {
  const month = planningMonth(data);
  return Array.from(new Set(monthDays(month).filter((day) => day.startsWith(month)).map(weekStart)));
}

function isIncomplete(data: Data, employeeId: string, week: string) {
  return weeklyDutySummary(data.state, employeeId, week).some((item) => item.count < item.target)
    || weeklyRestCount(data.state, employeeId, week) < WEEKLY_REST_TARGET;
}

function nextStepText(data: Data, employeeId: string, day: string) {
  const week = weekStart(day);
  const summary = weeklyDutySummary(data.state, employeeId, week);
  const primary = summary.find((item) => item.duty === "primary")!;
  const evening = summary.find((item) => item.duty === "evening")!;
  const rest = weeklyRestCount(data.state, employeeId, week);
  const weekLabel = `Week ${displayDay(week)}-${displayDay(addDays(week, 6))}.`;

  if (primary.count < primary.target) {
    const remaining = primary.target - primary.count;
    return `${weekLabel} Primary ${primary.count}/${primary.target}. Choose ${remaining} more Primary ${remaining === 1 ? "schedule" : "schedules"} for this week.`;
  }
  if (evening.count < evening.target) {
    const remaining = evening.target - evening.count;
    return `${weekLabel} Primary complete ${primary.count}/${primary.target}. Next: Evening ${evening.count}/${evening.target}. Choose ${remaining} more Evening ${remaining === 1 ? "schedule" : "schedules"}.`;
  }
  if (rest < WEEKLY_REST_TARGET) {
    const remaining = WEEKLY_REST_TARGET - rest;
    return `${weekLabel} Primary complete ${primary.count}/${primary.target}. Evening complete ${evening.count}/${evening.target}. Next: Rest Days ${rest}/${WEEKLY_REST_TARGET}. Choose ${remaining} more rest ${remaining === 1 ? "day" : "days"}.`;
  }
  return `${weekLabel} Complete. Primary ${primary.count}/${primary.target}, Evening ${evening.count}/${evening.target}, Rest Days ${rest}/${WEEKLY_REST_TARGET}. No more regular schedules are needed for this week.`;
}

export default function ScheduleCoach() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<Popup>(null);
  const lastVersion = useRef<number | null>(null);
  const initialGuideShown = useRef(false);

  const load = useCallback(async (guideDay?: string) => {
    try {
      const response = await fetch("/api/admin/operations-schedule", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as Data;
      const previous = lastVersion.current;
      lastVersion.current = body.version;
      setData(body);
      if (previous !== null && previous !== body.version) window.dispatchEvent(new Event("focus"));
      if (body.actor.role !== "admin" && !body.onboarding) {
        const employee = body.state.employees.find((item) => item.email === body.actor.email);
        if (employee && guideDay) {
          setPopup({ title: "Your next schedule step", body: nextStepText(body, employee.id, guideDay) });
        } else if (employee && !initialGuideShown.current) {
          initialGuideShown.current = true;
          const firstIncomplete = relevantWeeks(body).find((week) => isIncomplete(body, employee.id, week));
          if (firstIncomplete) setPopup({ title: "Start with this week", body: nextStepText(body, employee.id, firstIncomplete) });
        }
      }
    } catch {
      // The main schedule page already handles connection errors.
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const previousFetch = window.fetch;
    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const response = await previousFetch.call(window, input, init);
      try {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (method === "POST" && url.includes("/api/admin/operations-schedule")) {
          const result = await response.clone().json();
          let requestBody: Record<string, unknown> | null = null;
          if (typeof init?.body === "string") requestBody = JSON.parse(init.body) as Record<string, unknown>;
          if (!response.ok && result?.guide) {
            setPopup({ title: "Schedule guidance", body: String(result.error || "That schedule change is not available.") });
            if (response.status === 409) void load();
          } else if (response.ok && requestBody?.day) {
            void load(String(requestBody.day));
          }
        }
      } catch {
        // Never interfere with the actual schedule request.
      }
      return response;
    };
    window.fetch = wrappedFetch;
    return () => { if (window.fetch === wrappedFetch) window.fetch = previousFetch; };
  }, [load]);

  if (!data || data.actor.role === "admin" || data.onboarding) return popup ? (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-2xl">
        <h2 className="text-xl font-bold">{popup.title}</h2>
        <p className="mt-3 text-sm leading-6">{popup.body}</p>
        <button className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white" onClick={() => setPopup(null)}>OK, show me the available schedule</button>
      </section>
    </div>
  ) : null;

  const employee = data.state.employees.find((item) => item.email === data.actor.email);
  if (!employee) return null;
  const month = planningMonth(data);
  const weeks = relevantWeeks(data);

  return <>
    <div className="fixed bottom-4 left-4 z-40 max-w-[calc(100vw-2rem)]">
      {!open ? <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-emerald-300 bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-xl">My schedule progress</button> : <section className="max-h-[70vh] w-[min(92vw,430px)] overflow-auto rounded-2xl border border-slate-300 bg-white p-4 text-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-emerald-700">JRide schedule guide</div><h2 className="mt-1 text-lg font-bold">{employee.name} / {month}</h2></div><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1 text-sm">Close</button></div>
        <p className="mt-2 text-xs leading-5 text-slate-600">Choose Primary, then Evening, then your two Rest Days. Your target may be 2 or 3 for a duty because the rotating extra slot covers the 7th day. Backup is no longer part of the regular weekly schedule.</p>
        <div className="mt-3 space-y-3">{weeks.map((week) => {
          const summary = weeklyDutySummary(data.state, employee.id, week);
          const rest = weeklyRestCount(data.state, employee.id, week);
          return <article key={week} className="rounded-xl border border-slate-200 p-3"><strong className="text-sm">{displayDay(week)} - {displayDay(addDays(week, 6))}</strong><p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs font-semibold leading-5 text-slate-800">{nextStepText(data, employee.id, week)}</p><div className="mt-2 grid grid-cols-2 gap-2 text-xs">{summary.map((item) => <div key={item.duty} className={`rounded-lg p-2 ${item.count >= item.target ? "bg-emerald-50" : "bg-slate-100"}`}><span className="block text-slate-600">{item.label}</span><strong>{item.count}/{item.target}</strong></div>)}<div className={`rounded-lg p-2 ${rest >= WEEKLY_REST_TARGET ? "bg-emerald-50" : "bg-slate-100"}`}><span className="block text-slate-600">Rest days</span><strong>{rest}/{WEEKLY_REST_TARGET}</strong></div></div><div className="mt-2 text-xs text-slate-600">Available now: {DUTIES.map((duty: Duty) => `${DUTY_LABELS[duty]} ${Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((day) => getSlot(data.state, day, duty).owner === null).length}`).join(" / ")}</div></article>;
        })}</div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Status checks every 5 seconds. Once another coordinator takes a slot, it is no longer available to grab. Once your weekly target is complete, the system will not let you add another regular slot of that duty.</p>
      </section>}
    </div>
    {popup && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4"><section className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-2xl"><h2 className="text-xl font-bold">{popup.title}</h2><p className="mt-3 text-sm leading-6">{popup.body}</p><button className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white" onClick={() => setPopup(null)}>OK, show me the available schedule</button></section></div>}
  </>;
}
