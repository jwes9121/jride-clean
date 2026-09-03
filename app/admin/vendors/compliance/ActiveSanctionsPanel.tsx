"use client";

import { useState } from "react";
import { clean, fmt } from "./shared";

type Props = {
  sanctions: any[];
  canManage: boolean;
  busy: boolean;
  onRevoke: (sanction: any, reason: string) => Promise<boolean>;
  onError: (message: string) => void;
};

export default function ActiveSanctionsPanel({
  sanctions,
  canManage,
  busy,
  onRevoke,
  onError,
}: Props) {
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});

  async function revoke(row: any) {
    const reason = clean(revokeReasons[row.id]);
    if (reason.length < 5) {
      onError("Enter a clear revocation reason before revoking the sanction.");
      return;
    }
    const approved = window.confirm(
      `Revoke the active sanction for ${clean(row.vendor_name || row.vendor_id)}? The store will remain closed until the vendor opens it again.`
    );
    if (!approved) return;

    const saved = await onRevoke(row, reason);
    if (saved) {
      setRevokeReasons((current) => ({ ...current, [row.id]: "" }));
    }
  }

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="text-lg font-black">Active sanctions</h2>
      <div className="mt-3 space-y-3">
        {sanctions.length === 0 ? (
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-500">
            No active vendor sanctions.
          </div>
        ) : null}
        {sanctions.map((row) => (
          <div key={row.id} className="rounded-xl border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-black">{row.vendor_name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {row.sanction_type} | {fmt(row.starts_at)} to {fmt(row.ends_at)}
                </div>
                <div className="mt-2 rounded-lg bg-slate-50 p-3">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                    Vendor-facing violation
                  </div>
                  <div className="mt-1">
                    {clean(row.vendor_message || row.reason)}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-2">
                  <div>
                    <b>Violation code:</b> {clean(row.violation_code) || "-"}
                  </div>
                  <div>
                    <b>Scope:</b> {clean(row.suspension_scope) || "warning only"}
                  </div>
                  <div>
                    <b>Pending orders cancelled:</b>{" "}
                    {Number(row.pending_orders_cancelled || 0)}
                  </div>
                  <div>
                    <b>Vendor acknowledgment:</b>{" "}
                    {row.acknowledged_at
                      ? fmt(row.acknowledged_at)
                      : "Not yet acknowledged"}
                  </div>
                  <div>
                    <b>Created by:</b>{" "}
                    {clean(row.actor_email || row.created_by) || "-"}
                  </div>
                  <div>
                    <b>Reference:</b> {clean(row.id).slice(0, 8).toUpperCase()}
                  </div>
                </div>
                {canManage && clean(row.internal_note) ? (
                  <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
                    <b>Internal admin note:</b> {row.internal_note}
                  </div>
                ) : null}
              </div>
            </div>

            {canManage ? (
              <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:flex-row">
                <input
                  value={revokeReasons[row.id] || ""}
                  onChange={(event) =>
                    setRevokeReasons((current) => ({
                      ...current,
                      [row.id]: event.target.value,
                    }))
                  }
                  placeholder="Required reason for revocation"
                  maxLength={1000}
                  className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs"
                />
                <button
                  disabled={busy || clean(revokeReasons[row.id]).length < 5}
                  onClick={() => void revoke(row)}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 disabled:opacity-50"
                >
                  Revoke sanction
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
