"use client";

import { useState } from "react";
import { clean, vendorName } from "./shared";

type Props = {
  exemptions: any[];
  vendors: any[];
  canManage: boolean;
  busy: boolean;
  onAdd: (payload: {
    exemption_date: string;
    vendor_id: string | null;
    reason: string;
  }) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
};

export default function ComplianceExemptionsPanel({
  exemptions,
  vendors,
  canManage,
  busy,
  onAdd,
  onRemove,
}: Props) {
  const [date, setDate] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [reason, setReason] = useState("");

  async function add() {
    const saved = await onAdd({
      exemption_date: date,
      vendor_id: vendorId || null,
      reason,
    });
    if (saved) {
      setDate("");
      setVendorId("");
      setReason("");
    }
  }

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="text-lg font-black">Holiday / excused closure dates</h2>
      <p className="mt-1 text-xs text-slate-500">
        Leave the vendor blank to exempt every participating vendor for that
        date. Select one vendor for a store-specific approved closure.
      </p>
      {canManage ? (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[180px_1fr_1fr_auto]">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          />
          <select
            value={vendorId}
            onChange={(event) => setVendorId(event.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All vendors</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendorName(vendor)} - {clean(vendor.town) || "No town"}
              </option>
            ))}
          </select>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Holiday or approved closure reason"
            className="rounded-lg border px-3 py-2 text-sm"
          />
          <button
            disabled={busy || !date || !reason.trim()}
            onClick={() => void add()}
            className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            Add exemption
          </button>
        </div>
      ) : null}
      <div className="mt-3 space-y-1">
        {exemptions.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-xs"
          >
            <div>
              <b>{row.exemption_date}</b> - {row.reason}{" "}
              {row.vendor_id ? `(${row.vendor_name})` : "(All vendors)"}
            </div>
            {canManage ? (
              <button
                disabled={busy}
                onClick={() => void onRemove(clean(row.id))}
                className="rounded border px-2 py-1 font-bold"
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
