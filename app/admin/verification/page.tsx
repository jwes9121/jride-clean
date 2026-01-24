"use client";

import * as React from "react";

type Row = {
  passenger_id: string;
  full_name: string | null;
  town: string | null;
  status: string | null;
  submitted_at: string | null;
  admin_notes: string | null;
  id_front_path?: string | null;
  selfie_with_id_path?: string | null;
};

function fmt(s: any) {
  try { return new Date(String(s)).toLocaleString(); } catch { return String(s || ""); }
}

export default function AdminVerificationPage() {
  const [loading, setLoading] = React.useState(true);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [msg, setMsg] = React.useState<string>("");

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/verification/pending", { cache: "no-store" });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Failed to load pending");
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function decide(passenger_id: string, decision: "approve" | "reject", admin_notes: string) {
    setMsg("");
    try {
      const r = await fetch("/api/admin/verification/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passenger_id, decision, admin_notes }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Decision failed");
      await load();
    } catch (e: any) {
      setMsg(e?.message || "Decision failed");
    }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Passenger Verification (Admin)</div>
            <div className="text-sm opacity-70 mt-1">Approve or reject pending passenger verification requests.</div>
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

        <div className="mt-6 rounded-2xl border border-black/10 overflow-hidden">
          <div className="px-4 py-3 bg-black/5 text-sm font-semibold">
            {loading ? "Loading..." : ("Pending: " + rows.length)}
          </div>

          {!loading && rows.length === 0 ? (
            <div className="p-4 text-sm">No pending verifications.</div>
          ) : null}

          {rows.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-black/5">
                <tr>
                  <th className="text-left p-3">Passenger</th>
                  <th className="text-left p-3">Town</th>
                  <th className="text-left p-3">Submitted</th>
                  <th className="text-left p-3">Admin notes</th>
                  <th className="text-left p-3">Uploads</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowItem key={r.passenger_id} row={r} onDecide={decide} />
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function RowItem({ row, onDecide }: { row: Row; onDecide: (id: string, d: "approve" | "reject", n: string) => void }) {
  const [notes, setNotes] = React.useState<string>(row.admin_notes || "");

  return (
    <tr className="border-t border-black/10">
      <td className="p-3">
        <div className="font-semibold">{row.full_name || "(no name)"}</div>
        <div className="text-xs opacity-70">{row.passenger_id}</div>
      </td>
      <td className="p-3">{row.town || ""}</td>
      <td className="p-3">{fmt(row.submitted_at)}</td>
      <td className="p-3">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes"
          className="w-full rounded-xl border border-black/10 px-3 py-2"
        />
      </td>
      <td className="p-3">
        <div className="text-xs opacity-80">id: {String(row.id_front_path || "")}</div>
        <div className="text-xs opacity-80 mt-1">selfie: {String(row.selfie_with_id_path || "")}</div>
        <div className="text-xs opacity-60 mt-1">
          Note: show paths only (private bucket). We can add signed preview next.
        </div>
      </td>
      <td className="p-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDecide(row.passenger_id, "approve", notes)}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 font-semibold"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onDecide(row.passenger_id, "reject", notes)}
            className="rounded-xl bg-red-600 hover:bg-red-500 text-white px-4 py-2 font-semibold"
          >
            Reject
          </button>
        </div>
      </td>
    </tr>
  );
}