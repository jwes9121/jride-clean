"use client";

import { useCallback, useEffect, useState } from "react";

type Reading = {
  employee_id: string;
  staff_email: string;
  staff_name: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  device_captured_at: string | null;
  created_at: string;
};

type EmployeeLocation = {
  id: string;
  name: string;
  area: string;
  email: string;
  latest: Reading | null;
};

type Data = {
  employees: EmployeeLocation[];
  serverTime: string;
};

function phTime(value: string | null) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export default function EmployeeGpsTestPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/employee-location", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.employees)) throw new Error(body.error || "GPS test data is unavailable.");
      setData(body);
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "GPS test data is unavailable.");
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(load, 10000);
    return () => window.clearInterval(interval);
  }, [load]);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">JRide staff operations</div>
            <h1 className="mt-2 text-3xl font-bold">Employee GPS Accuracy Test</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Use this during the meeting to compare each employee's actual location with the phone/browser reading. The page refreshes every 10 seconds.</p>
          </div>
          <div className="flex gap-2">
            <a href="/admin/operations-schedule" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Back to schedule</a>
            <button type="button" onClick={load} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Refresh</button>
          </div>
        </div>

        {error && <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          {(data?.employees || []).map((employee) => {
            const reading = employee.latest;
            const mapUrl = reading
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${reading.latitude},${reading.longitude}`)}`
              : "";
            return (
              <article key={employee.id} className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold">{employee.name}</h2>
                    <p className="text-sm text-slate-600">{employee.area}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${reading ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                    {reading ? "READING RECEIVED" : "WAITING"}
                  </span>
                </div>

                {!employee.email && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This coordinator has not linked a Google account yet.</p>}

                {reading ? (
                  <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 text-sm">
                    <div className="col-span-2">
                      <dt className="text-slate-500">GPS accuracy reported by device</dt>
                      <dd className="mt-1 text-2xl font-bold">+/- {Math.round(reading.accuracy_m)} m</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Latitude</dt>
                      <dd className="mt-1 font-semibold">{Number(reading.latitude).toFixed(6)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Longitude</dt>
                      <dd className="mt-1 font-semibold">{Number(reading.longitude).toFixed(6)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-slate-500">Server received</dt>
                      <dd className="mt-1 font-semibold">{phTime(reading.created_at)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-slate-500">Device captured</dt>
                      <dd className="mt-1 font-semibold">{phTime(reading.device_captured_at)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-5 text-sm leading-6 text-slate-600">Ask the employee to keep the Operations Schedule page open and allow location access when the phone/browser asks.</p>
                )}

                {reading && (
                  <a href={mapUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex rounded-lg border border-slate-400 px-4 py-2 text-sm font-semibold">
                    Open GPS pin on map
                  </a>
                )}
              </article>
            );
          })}
        </section>

        {!data && !error && <div className="mt-6 rounded-lg border border-slate-300 bg-white p-6 text-sm text-slate-600">Loading employee GPS readings...</div>}
        {data && data.employees.length === 0 && <div className="mt-6 rounded-lg border border-slate-300 bg-white p-6 text-sm text-slate-600">No coordinators are configured in the Operations Schedule.</div>}
      </div>
    </main>
  );
}
