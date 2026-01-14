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
  for (const r of rows) Object.keys(r || {}).forEach((k) => set.add(k));
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

type DateMode = "all" | "today" | "yesterday" | "week" | "month" | "custom";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// Monday-start week (LGU-friendly)
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // move to Monday
  x.setDate(x.getDate() + diff);
  return x;
}

function startOfMonth(d: Date) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function parseDateSafe(v: any): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return d;
}

function pickTripDate(t: AnyObj): { date: Date | null; field: string | null } {
  const fields = ["created_at", "requested_at", "pickup_time", "inserted_at"];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(t, f)) {
      const d = parseDateSafe(t[f]);
      if (d) return { date: d, field: f };
    }
  }
  return { date: null, field: null };
}

export default function FinancialSummaryPage() {
  const [raw, setRaw] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [mode, setMode] = useState<DateMode>("all");
  const [fromYmd, setFromYmd] = useState<string>("");
  const [toYmd, setToYmd] = useState<string>("");

  async function loadSnapshot() {
    setLoading(true);
    setErr(null);
    setRaw(null);
    try {
      // GET only; no mutations
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

  const tripsAll = useMemo(() => parseTrips(raw), [raw]);

  const range = useMemo(() => {
    const now = new Date();
    if (mode === "all") return { from: null as Date | null, to: null as Date | null, label: "ALL" };

    if (mode === "today") {
      const f = startOfDay(now);
      const t = endOfDay(now);
      return { from: f, to: t, label: `TODAY_${ymd(f)}` };
    }

    if (mode === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const f = startOfDay(y);
      const t = endOfDay(y);
      return { from: f, to: t, label: `YESTERDAY_${ymd(f)}` };
    }

    if (mode === "week") {
      const f = startOfWeek(now);
      const t = endOfDay(now);
      return { from: f, to: t, label: `WEEK_${ymd(f)}_TO_${ymd(t)}` };
    }

    if (mode === "month") {
      const f = startOfMonth(now);
      const t = endOfDay(now);
      return { from: f, to: t, label: `MONTH_${ymd(f)}_TO_${ymd(t)}` };
    }

    // custom
    const f = fromYmd ? startOfDay(new Date(fromYmd + "T00:00:00")) : null;
    const t = toYmd ? endOfDay(new Date(toYmd + "T00:00:00")) : null;
    const label = `CUSTOM_${fromYmd || "NA"}_TO_${toYmd || "NA"}`;
    return { from: f, to: t, label };
  }, [mode, fromYmd, toYmd]);

  const filtered = useMemo(() => {
    const { from, to } = range;
    if (!from && !to) return { trips: tripsAll, dateField: null as string | null, missingDates: 0 };

    let usedField: string | null = null;
    let missingDates = 0;

    const out: Trip[] = [];
    for (const t of tripsAll) {
      const picked = pickTripDate(t);
      if (!picked.date) {
        missingDates++;
        continue;
      }
      if (!usedField && picked.field) usedField = picked.field;

      const d = picked.date.getTime();
      if (from && d < from.getTime()) continue;
      if (to && d > to.getTime()) continue;
      out.push(t);
    }
    return { trips: out, dateField: usedField, missingDates };
  }, [tripsAll, range]);

  const computed = useMemo(() => {
    const trips = filtered.trips;

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
      { metric: "Range", value: range.label, note: "" },
      { metric: "Trips (total)", value: trips.length, note: "Filtered snapshot rows" },
      { metric: "Trips (completed)", value: counts.completed, note: "" },
      { metric: "Trips (active)", value: active, note: "assigned/on_the_way/arrived/enroute/on_trip" },
      { metric: "Trips (requested)", value: counts.requested, note: "" },
      { metric: "Trips (cancelled)", value: counts.cancelled, note: "" },

      { metric: "Gross Total (best-effort)", value: gross, note: grossCount ? `Derived from ${grossCount} rows` : "No numeric total fields found in rows" },
      { metric: "Platform Fee (best-effort)", value: platformFee, note: platformCount ? `Derived from ${platformCount} rows` : "No platform fee fields found" },
      { metric: "Driver Payout (best-effort)", value: driverPayout, note: driverCount ? `Derived from ${driverCount} rows` : "No driver payout fields found" },
      { metric: "Vendor Total (best-effort)", value: vendorTotal, note: vendorCount ? `Derived from ${vendorCount} rows` : "No vendor total fields found" },
    ];

    return { rows };
  }, [filtered.trips, filtered.dateField, filtered.missingDates, range.label]);

  const card: any = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "white" };
  const btn: any = { display: "inline-block", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 10, background: "white", fontSize: 13, textDecoration: "none", cursor: "pointer" };
  const btnDisabled: any = { ...btn, opacity: 0.55, cursor: "not-allowed" };

  const showDateWarning = !!raw && mode !== "all" && (filtered.dateField === null);

  function setPreset(m: DateMode) {
    setMode(m);
    if (m !== "custom") {
      setFromYmd("");
      setToYmd("");
    }
  }

  const csvName = `financial_summary_${range.label}_${new Date().toISOString().slice(0, 10)}.csv`;

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

        <button type="button" style={!raw ? btnDisabled : btn} disabled={!raw} onClick={() => downloadCsv(csvName, computed.rows)}>
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

      <div style={{ marginTop: 12, ...card }}>
        <div style={{ fontWeight: 800 }}>Date Range</div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={btn} onClick={() => setPreset("all")}>All</button>
          <button type="button" style={btn} onClick={() => setPreset("today")}>Today</button>
          <button type="button" style={btn} onClick={() => setPreset("yesterday")}>Yesterday</button>
          <button type="button" style={btn} onClick={() => setPreset("week")}>This Week</button>
          <button type="button" style={btn} onClick={() => setPreset("month")}>This Month</button>
          <button type="button" style={btn} onClick={() => setPreset("custom")}>Custom</button>
        </div>

        {mode === "custom" ? (
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>From</div>
            <input type="date" value={fromYmd} onChange={(e) => setFromYmd(e.target.value)} style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 10 }} />
            <div style={{ fontSize: 13, opacity: 0.8 }}>To</div>
            <input type="date" value={toYmd} onChange={(e) => setToYmd(e.target.value)} style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 10 }} />
          </div>
        ) : null}

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          Current: <b>{range.label}</b>
          {raw ? (
            <>
              {" "}Â· Filtered rows: <b>{filtered.trips.length}</b> / {tripsAll.length}
              {" "}Â· Date field: <b>{filtered.dateField || "N/A"}</b>
              {filtered.missingDates ? <> Â· Missing dates: <b>{filtered.missingDates}</b></> : null}
            </>
          ) : null}
        </div>

        {showDateWarning ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid #fed7aa", background: "#fffbeb", fontSize: 12 }}>
            Date filtering could not be applied because no recognized date fields were found on snapshot rows
            (checked: created_at, requested_at, pickup_time, inserted_at). Totals shown remain unfiltered.
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 12, ...card }}>
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
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, wordBreak: "break-word" }}>{String(r.value)}</div>
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