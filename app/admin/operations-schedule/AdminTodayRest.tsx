"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DUTIES, getSlot, localDate, restCount, weekStart, type Schedule } from "@/lib/operations-schedule";

type Data = {
  version: number;
  state: Schedule;
  actor: { email: string; role: string; name: string };
  serverTime: string;
};

export default function AdminTodayRest() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/operations-schedule", { cache: "no-store" });
      const body = (await response.json()) as Data & { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to load today's rest-day status.");
      if (body.actor.role !== "admin") {
        setData(null);
        return;
      }
      setData(body);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load today's rest-day status.");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [load]);

  const details = useMemo(() => {
    if (!data) return null;
    const today = localDate(new Date(data.serverTime));
    const current = data.state.rests[today] || "";
    const options = data.state.employees.map(employee => {
      const duty = DUTIES.find(item => getSlot(data.state, today, item).owner === employee.id);
      const rests = restCount(data.state, employee.id, weekStart(today));
      const eligible = !duty && (current === employee.id || rests < 2);
      const status = duty
        ? `assigned ${duty === "primary" ? "Primary" : "Evening"} today`
        : current === employee.id
          ? "current rest day"
          : rests >= 2
            ? "already has 2/2 rest days"
            : `${rests}/2 rest days this week`;
      return { employee, eligible, status };
    });
    return { today, current, options };
  }, [data]);

  useEffect(() => {
    if (!details) return;
    if (details.current) {
      setTarget(details.current);
      return;
    }
    const eligible = details.options.filter(item => item.eligible);
    if (eligible.length === 1) setTarget(eligible[0].employee.id);
  }, [details]);

  async function save(employee: string | null) {
    if (!data || !details || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/operations-schedule/today-rest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: data.version, employee }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Today's rest day could not be saved.");
      setMessage(employee ? "Today's rest day was assigned." : "Today's rest day was removed.");
      await load();
      window.dispatchEvent(new Event("focus"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Today's rest day could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!data || !details) return null;

  const currentName = data.state.employees.find(employee => employee.id === details.current)?.name || "Not assigned";
  const selected = details.options.find(item => item.employee.id === target);

  return <div className="fixed bottom-4 right-4 z-[70] max-w-[calc(100vw-2rem)] text-slate-900">
    {!open ? <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-bold shadow-xl">
      Admin: Today RD
    </button> : <section className="w-[min(92vw,390px)] rounded-2xl border border-slate-300 bg-white p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Admin only</div><h2 className="mt-1 text-lg font-bold">Today's Rest Day</h2></div>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1 text-sm">Close</button>
      </div>
      <p className="mt-2 text-sm text-slate-600">{details.today} / Current: <strong>{currentName}</strong></p>
      <label htmlFor="today-rest-employee" className="mt-3 block text-sm font-semibold">Assign employee</label>
      <select id="today-rest-employee" value={target} onChange={e => setTarget(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base">
        <option value="">Choose employee</option>
        {details.options.map(item => <option key={item.employee.id} value={item.employee.id} disabled={!item.eligible}>{item.employee.name} - {item.status}</option>)}
      </select>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !target || !selected?.eligible} onClick={() => void save(target)} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Set today's RD</button>
        {details.current && <button type="button" disabled={busy} onClick={() => void save(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Remove today's RD</button>}
      </div>
      {message && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{message}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <p className="mt-3 text-xs leading-5 text-slate-500">Employees still cannot retroactively choose or remove today's RD. Admin can correct today's assignment when the schedule was not completed before the day started.</p>
    </section>}
  </div>;
}
