"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type AnyObj = Record<string, any>;
type Trip = AnyObj;

function safeArr<T>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function parseTrips(j: any): Trip[] {
  if (!j) return [];
  const candidates = [
    j.trips,
    j.bookings,
    j.data,
    j.rows,
    j.items,
    j.result,
    j.payload,
    Array.isArray(j) ? j : null,
  ];
  for (const c of candidates) {
    const arr = safeArr<Trip>(c);
    if (arr.length) return arr;
  }
  for (const k of Object.keys(j || {})) {
    const arr = safeArr<Trip>((j as AnyObj)[k]);
    if (arr.length && typeof arr[0] === "object") return arr;
  }
  return [];
}

function norm(v: any): string {
  return String(v ?? "").toLowerCase().trim();
}

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function pickFirstNumber(obj: AnyObj, keys: string[]): number | null {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const n = toNum(obj[k]);
      if (n !== null) return n;
    }
  }
  return null;
}

function downloadCsv(filename: string, rows: AnyObj[]) {
  const set = new Set<string>();
  for (const r of rows) {
    Object.keys(r || {}).forEach((k) => set.add(k));
  }
  const headers = [...set];

  const esc = (v: any) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines: string[] = [];
  lines.push(headers.map(esc).join(","));
  for (const r of rows) lines.push(headers.map((h) => esc((r as AnyObj)[h])).join(","));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function FinancialSummaryPage() {
  const [raw, setRaw] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadSnapshot() {
    setLoading(true);
    setErr(null);
    setRaw(null);
    try {
      const r = await fetch("/api/admin/livetrips/page-data", { method: "GET", cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error((j && (j.error || j.message)) || `HTTP ${r.status}`);
      setRaw(j);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load"));
    } finally {
      setLoading(false);
    }
  }

  const trips = useMemo(() => parseTrips(raw), [raw]);

  const computed = useMemo(() => {
    const totalKeys = ["total", "total_amount", "grand_total", "amount", "fare", "total_fare", "price_total", "bill_total"];
    const platformKeys = ["platform_fee", "company_cut", "commission", "service_fee", "app_fee", "fee_amount"];
    const driverKeys = ["driver_payout", "driver_amount", "driver_share", "net_driver", "driver_net"];
    const vendorKeys = ["vendor_total", "vendor_amount", "vendor_net", "net_vendor"];

    let gross = 0, platformFee = 0, driverPayout = 0, vendorTotal = 0;
    let grossCount = 0, platformCount = 0, driverCount = 0, vendorCount = 0;

    const counts: Record<string, number> = {
      requested: 0, assigned: 0, on_the_way: 0, arrived: 0, enroute: 0, on_trip: 0, completed: 0, cancelled: 0, other: 0,
    };

    for (const t of trips) {
      const st = norm(t.status);
      if (Object.prototype.hasOwnProperty.call(counts, st)) counts[st] += 1;
      else counts.other += 1;

      const g = pickFirstNumber(t, totalKeys);
      if (g !== null) { gross += g; grossCount++; }

      const pf = pickFirstNumber(t, platformKeys);
      if (pf !== null) { platformFee += pf; platformCount++; }

      const dp = pickFirstNumber(t, driverKeys);
      if (dp !== null) { driverPayout += dp; driverCount++; }

      const vt = pickFirstNumber(t, vendorKeys);
      if (vt !== null) { vendorTotal += vt; vendorCount++; }
    }

    const active = counts.assigned + counts.on_the_way + counts.arrived + counts.enroute + counts.on_trip;

    const rows = [
      { metric: "Trips (total)", value: trips.length, note: "Snapshot rows loaded" },
      { metric: "Trips (completed)", value: counts.completed, note: "" },
      { metric: "Trips (active)", value: active, note: "assigned/on_the_way/arrived/enroute/on_trip" },
      { metric: "Trips (requested)", value: counts.requested, note: "" },
      { metric: "Trips (cancelled)", value: counts.cancelled, note: "" },

      { metric: "Gross Total (best-effort)", value: gross, note: grossCount ? `Derived from ${grossCount} rows using keys: ${totalKeys.join(", ")}` : "No numeric total fields found in snapshot rows" },
      { metric: "Platform Fee (best-effort)", value: platformFee, note: platformCount ? `Derived from ${platformCount} rows using keys: ${platformKeys.join(", ")}` : "No platform fee fields found" },
      { metric: "Driver Payout (best-effort)", value: driverPayout, note: driverCount ? `Derived from ${driverCount} rows using keys: ${driverKeys.join(", ")}` : "No driver payout fields found" },
      { metric: "Vendor Total (best-effort)", value: vendorTotal, note: vendorCount ? `Derived from ${vendorCount} rows using keys: ${vendorKeys.join(", ")}` : "No vendor total fields found" },
    ];

    return { rows };
  }, [trips]);

  const card: any = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "white" };
  const btn: any = { display: "inline-block", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 10, background: "white", fontSize: 13, textDecoration: "none", cursor: "pointer" };
  const btnDisabled: any = { ...btn, opacity: 0.55, cursor: "not-allowed" };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Financial Summary (Read-only)</h1>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
        Snapshot-based totals derived from existing LiveTrips page-data. GET-only on click. No wallet mutations.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={loading ? btnDisabled : btn} onClick={loadSnapshot} disabled={loading}>
          {loading ? "Loading snapshot..." : "Load snapshot (GET)"}
        </button>

        <button
          type="button"
          style={!raw ? btnDisabled : btn}
          disabled={!raw}
          onClick={() => downloadCsv(`financial_summary_${new Date().toISOString().slice(0, 10)}.csv`, computed.rows)}
        >
          Export CSV (derived)
        </button>

        <Link href="/admin/control-center" style={btn}>Back to Control Center</Link>
        <Link href="/admin/reports/lgu" style={btn}>Open LGU Exports</Link>
        <Link href="/admin/ops/health" style={btn}>Open Ops Health</Link>
      </div>

      {err ? (
        <div style={{ ...card, marginTop: 12, borderColor: "#fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 800 }}>Error</div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>{err}</div>
        </div>
      ) : null}

      <div style={{ marginTop: 14, ...card }}>
        <div style={{ fontWeight: 800 }}>Summary</div>

        {!raw ? (
          <div style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>
            No snapshot loaded yet. Click <b>Load snapshot (GET)</b>.
          </div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {computed.rows.map((r, idx) => (
              <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "white" }}>
                <div style={{ fontWeight: 800 }}>{r.metric}</div>
                <div style={{ marginTop: 6, fontSize: 26, fontWeight: 900 }}>{String(r.value)}</div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>{r.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
        Locked rule: read-only UI. GET-only on click. No wallet mutations. No Mapbox changes. No LiveTrips logic changes.
      </div>
    </div>
  );
}