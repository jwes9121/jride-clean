"use client";

import * as React from "react";

type Row = { passenger_id: string };

export default function AdminControlCenter() {
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState<number>(0);
  const [msg, setMsg] = React.useState<string>("");
  const [role, setRole] = React.useState<string>("admin");

  React.useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const r = (qs.get("role") || "admin").toLowerCase();
      setRole(r);
    } catch {
      setRole("admin");
    }
  }, []);

  const isDispatcher = role === "dispatcher";

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/verification/pending", { cache: "no-store" });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Failed to load verification counts");
      const rows: Row[] = Array.isArray(j.rows) ? j.rows : [];
      setPending(rows.length);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load.");
      setPending(0);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Admin Control Center</div>
            <div className="text-sm opacity-70 mt-1">Centralized navigation hub (counts are live). Role: {role}</div>
          </div>
          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Refresh
          </button>
        </div>

        {msg ? <div className="mt-4 text-sm text-amber-700">{msg}</div> : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-black/10 p-4">
            <div className="text-sm font-semibold">Pending passenger verifications</div>
            <div className="text-3xl font-bold mt-2">{loading ? "-" : pending}</div>
            <div className="text-xs opacity-70 mt-1">Queue count</div>

            <div className="mt-3 flex gap-2">
              <a
                href="/admin/verification"
                className={"rounded-xl px-4 py-2 font-semibold " + (isDispatcher ? "bg-slate-200 text-slate-500 cursor-not-allowed pointer-events-none" : "bg-black text-white")}
              >
                Open Admin
              </a>
              <a
                href="/admin/dispatcher-verifications"
                className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
              >
                Dispatcher
              </a>
            </div>

            {isDispatcher ? (
              <div className="text-xs text-slate-600 mt-2">
                Dispatcher mode: Admin approve/reject is disabled here.
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-black/10 p-4">
            <div className="text-sm font-semibold">Verification pages</div>
            <div className="text-xs opacity-70 mt-2">
              Admin: approve/reject. Dispatcher: read-only queue view.
            </div>
            <div className="mt-3 grid gap-2">
              <a
                href="/admin/verification"
                className={"rounded-xl border border-black/10 px-4 py-2 font-semibold " + (isDispatcher ? "bg-slate-100 text-slate-500 pointer-events-none" : "hover:bg-black/5")}
              >
                Passenger Verification (Admin)
              </a>
              <a
                href="/admin/dispatcher-verifications"
                className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
              >
                Passenger Verification (Dispatcher)
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 p-4">
            <div className="text-sm font-semibold">Notes</div>
            <div className="text-xs opacity-70 mt-2">
              Role gating is UI-only right now. We will also enforce server checks in the decide route next.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}