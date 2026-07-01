"use client";

import { useEffect, useMemo, useState } from "react";

type InboxSummary = {
  pending: number;
  needs_review: number;
  approved_today: number;
  rejected: number;
  failed: number;
  posted: number;
};

type InboxRow = {
  id: string;
  status: string;
  business_event: string;
  finance_event: string;
  source_module: string | null;
  source_id: string | null;
  business_unit: string | null;
  location: string | null;
  amount: number | string | null;
  posting_rule: string | null;
  rule_version: number | string | null;
  warnings: string[];
  created_at: string | null;
  processed_at: string | null;
  journal_entry_id: string | null;
};

type InboxResponse = {
  ok: boolean;
  summary: InboxSummary;
  rows: InboxRow[];
  error?: string;
  message?: string;
};

function money(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return "PHP " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(v: any) {
  if (!v) return "-";
  const d = new Date(String(v));
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString();
}

function label(v: any) {
  return String(v || "-").replace(/_/g, " ");
}

function statusClass(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "failed") return "bg-red-100 text-red-700 border-red-200";
  if (s === "processed" || s === "posted") return "bg-green-100 text-green-700 border-green-200";
  if (s === "pending") return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (s === "ignored") return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-orange-100 text-orange-700 border-orange-200";
}

function useFinanceInbox() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/finance/inbox?limit=50", {
        method: "GET",
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || "Failed to load Finance Inbox");
      }
      setData(json);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load Finance Inbox"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return { data, loading, err, reload: load };
}

function ReviewDrawer({
  row,
  onClose,
}: {
  row: InboxRow | null;
  onClose: () => void;
}) {
  if (!row) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close review drawer"
        className="absolute inset-0 bg-slate-900/30"
        onClick={onClose}
      />

      <aside className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 border-b border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Review Finance Event</h2>
              <p className="mt-1 text-sm text-slate-500">{row.id}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Event Details</h3>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Business Event</dt>
                <dd className="font-semibold text-slate-900">{label(row.business_event)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Source Module</dt>
                <dd className="font-semibold text-slate-900">{row.source_module || "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Source Record</dt>
                <dd className="font-semibold text-slate-900">{row.source_id || "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Business Unit</dt>
                <dd className="font-semibold text-slate-900">{row.business_unit || "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Location</dt>
                <dd className="font-semibold text-slate-900">{row.location || "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Amount</dt>
                <dd className="font-semibold text-slate-900">{money(row.amount)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Created At</dt>
                <dd className="font-semibold text-slate-900">{fmtDate(row.created_at)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Posting Rule</h3>
            <div className="mt-3 text-sm">
              <div className="font-semibold text-slate-900">{row.posting_rule || "Not resolved"}</div>
              <div className="mt-1 text-slate-500">
                Rule Version: {row.rule_version ? `v${row.rule_version}` : "-"}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Warnings</h3>
            {row.warnings?.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-orange-700">
                {row.warnings.map((w) => (
                  <li key={w}>{label(w)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No warnings.</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Proposed Journal</h3>
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              Proposed journal preview will appear after posting rule execution is wired.
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Posting History</h3>
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              Posting history will show finance_posting_runs in the next sprint step.
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">Actions</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled className="rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600">
                Approve soon
              </button>
              <button disabled className="rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600">
                Reject soon
              </button>
              <button disabled className="rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600">
                Replay soon
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

export default function FinanceInboxPage() {
  const { data, loading, err, reload } = useFinanceInbox();
  const [selectedRow, setSelectedRow] = useState<InboxRow | null>(null);

  const summary = data?.summary || {
    pending: 0,
    needs_review: 0,
    approved_today: 0,
    rejected: 0,
    failed: 0,
    posted: 0,
  };

  const rows = useMemo(() => data?.rows || [], [data]);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Finance Inbox</h1>
            <p className="mt-1 text-sm text-slate-600">
              Review finance events before they become posted journal entries.
            </p>
          </div>

          <button
            onClick={reload}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase text-slate-500">Pending</div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{summary.pending}</div>
          </div>
          <div className="rounded-xl border border-orange-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase text-orange-600">Needs Review</div>
            <div className="mt-2 text-2xl font-bold text-orange-700">{summary.needs_review}</div>
          </div>
          <div className="rounded-xl border border-green-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase text-green-600">Posted</div>
            <div className="mt-2 text-2xl font-bold text-green-700">{summary.posted}</div>
          </div>
          <div className="rounded-xl border border-red-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase text-red-600">Failed</div>
            <div className="mt-2 text-2xl font-bold text-red-700">{summary.failed}</div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <h2 className="font-semibold text-slate-900">Inbox Items</h2>
            <p className="mt-1 text-sm text-slate-500">Review drawer is read-only in this version.</p>
          </div>

          {loading ? (
            <div className="p-6 text-sm text-slate-600">Loading Finance Inbox...</div>
          ) : err ? (
            <div className="p-6">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {err}
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-slate-600">No finance inbox items yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-100 text-left text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Business Event</th>
                    <th className="px-4 py-3">Business Unit</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Rule</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(row.status)}`}>
                          {label(row.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{label(row.business_event)}</div>
                        <div className="text-xs text-slate-500">{row.source_module || "-"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.business_unit || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">{row.location || "-"}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{money(row.amount)}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.posting_rule || "Not resolved"}
                        {row.rule_version ? <span className="ml-1 text-xs text-slate-500">v{row.rule_version}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{fmtDate(row.created_at)}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedRow(row)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <ReviewDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
    </main>
  );
}
