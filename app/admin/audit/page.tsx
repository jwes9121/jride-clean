"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Audit = {
  id: number;
  at: string; // timestamptz
  actor_email: string | null;
  booking_id: string;
  driver_id: string;
  override: boolean;
  reason: string | null;
  booking_town: string | null;
  driver_town: string | null;
  old_status: string | null;
  new_status: string | null;
};

type Toast = { id: string; title: string; description?: string };
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  function push(t: Omit<Toast, "id">) {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, ...t }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3000);
  }
  return { toasts, push };
}

export default function AuditPage() {
  const [rows, setRows] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [from, setFrom] = useState<string>(() => {
    // default: last 7 days
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [actor, setActor] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [overrideOnly, setOverrideOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const { toasts, push } = useToast();

  async function load() {
    setLoading(true);
    setErrorText(null);
    try {
      let q = supabase
        .from("booking_assignment_audit")
        .select("*", { count: "exact" })
        .order("at", { ascending: false });

      // date bounds (inclusive)
      const fromISO = from ? new Date(from + "T00:00:00").toISOString() : null;
      const toISO = to ? new Date(to + "T23:59:59").toISOString() : null;
      if (fromISO) q = q.gte("at", fromISO);
      if (toISO) q = q.lte("at", toISO);

      if (actor.trim()) q = q.ilike("actor_email", `%${actor.trim()}%`);
      if (overrideOnly) q = q.eq("override", true);

      // Booking filter: exact if full UUID, else ignore (we keep it simple)
      const bid = bookingId.trim();
      if (bid && bid.length >= 36) {
        q = q.eq("booking_id", bid);
      }

      const fromRow = (page - 1) * pageSize;
      const toRow = fromRow + pageSize - 1;
      q = q.range(fromRow, toRow);

      const { data, error } = await q;
      if (error) throw error;

      setRows((data ?? []) as Audit[]);
    } catch (e: any) {
      setErrorText(e?.message ?? "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // initial

  function exportCSV() {
    if (!rows.length) return push({ title: "Nothing to export" });
    const headers = [
      "id",
      "at",
      "actor_email",
      "booking_id",
      "driver_id",
      "override",
      "reason",
      "booking_town",
      "driver_town",
      "old_status",
      "new_status",
    ];
    const escape = (s: any) => {
      if (s === null || s === undefined) return "";
      const str = String(s).replace(/"/g, '""');
      return `"${str}"`;
    };
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.at,
          r.actor_email ?? "",
          r.booking_id,
          r.driver_id,
          r.override ? "true" : "false",
          r.reason ?? "",
          r.booking_town ?? "",
          r.driver_town ?? "",
          r.old_status ?? "",
          r.new_status ?? "",
        ]
          .map(escape)
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `jride-audit-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const busy = useMemo(() => loading, [loading]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Assignment Audit</h1>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <label className="text-sm">
          <div className="mb-1">From</div>
          <input
            type="date"
            className="border rounded px-2 py-1 w-full"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <div className="mb-1">To</div>
          <input
            type="date"
            className="border rounded px-2 py-1 w-full"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <div className="mb-1">Actor (email contains)</div>
          <input
            className="border rounded px-2 py-1 w-full"
            placeholder="admin@example.com"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <div className="mb-1">Booking ID (full UUID)</div>
          <input
            className="border rounded px-2 py-1 w-full"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
          />
        </label>
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={overrideOnly}
            onChange={(e) => setOverrideOnly(e.target.checked)}
          />
          <span>Override only</span>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setPage(1);
            load();
          }}
          disabled={busy}
          className={"px-3 py-1 rounded text-sm text-white " + (busy ? "bg-gray-400" : "bg-black")}
        >
          {busy ? "Loading…" : "Apply filters"}
        </button>
        <button
          onClick={exportCSV}
          className="px-3 py-1 rounded text-sm border bg-white"
          disabled={!rows.length}
        >
          Export CSV
        </button>
      </div>

      {errorText && <div className="text-sm text-red-600">{errorText}</div>}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Time</th>
              <th>Actor</th>
              <th>Booking</th>
              <th>Driver</th>
              <th>Override</th>
              <th>Reason</th>
              <th>Booking Town</th>
              <th>Driver Town</th>
              <th>Old → New</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2">{new Date(r.at).toLocaleString()}</td>
                <td>{r.actor_email ?? "—"}</td>
                <td className="font-mono text-xs">{r.booking_id.slice(0, 8)}…</td>
                <td className="font-mono text-xs">{r.driver_id.slice(0, 8)}…</td>
                <td>{r.override ? "Yes" : "No"}</td>
                <td className="max-w-[320px]">{r.reason ?? "—"}</td>
                <td>{r.booking_town ?? "—"}</td>
                <td>{r.driver_town ?? "—"}</td>
                <td>
                  {(r.old_status ?? "—") + " → " + (r.new_status ?? "—")}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !busy && (
              <tr>
                <td colSpan={9} className="py-6 text-center opacity-60">
                  No results with current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Simple pagination */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setPage((p) => Math.max(1, p - 1));
            setTimeout(load, 0);
          }}
          disabled={page <= 1 || busy}
          className="px-3 py-1 rounded text-sm border bg-white disabled:opacity-50"
        >
          Prev
        </button>
        <div className="text-sm">Page {page}</div>
        <button
          onClick={() => {
            setPage((p) => p + 1);
            setTimeout(load, 0);
          }}
          disabled={busy || rows.length < pageSize}
          className="px-3 py-1 rounded text-sm border bg-white disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className="bg-black text-white rounded px-3 py-2 shadow">
            <div className="font-semibold">{t.title}</div>
            {t.description && <div className="text-xs opacity-80">{t.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
