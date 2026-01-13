"use client";

import { useEffect, useMemo, useState } from "react";

type AnyRow = Record<string, any>;
type Banner = { kind: "ok" | "warn" | "err"; text: string } | null;

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 320) return raw.slice(0, 320) + "...";
  return raw;
}

function toMonthStart(monthValue: string): string {
  const m = String(monthValue || "").trim();
  if (!m || m.length < 7) return "";
  return m + "-01";
}

function isNumericValue(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string" && v.trim() !== "") return Number.isFinite(Number(v));
  return false;
}

function fmtNum(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return n.toFixed(2);
}

function csvEscape(v: any): string {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function downloadCsvGeneric(columns: string[], rows: AnyRow[], totals?: Record<string, number>, fileBase?: string) {
  const lines: string[] = [];
  lines.push(columns.map(csvEscape).join(","));
  for (const r of rows) {
    lines.push(columns.map((c) => csvEscape(r?.[c])).join(","));
  }

  // Optional totals row
  if (totals) {
    const anyNum = columns.some((c) => Number.isFinite(totals[c]) && totals[c] !== 0);
    if (anyNum) {
      const totRow = columns.map((c, idx) => {
        if (isNumericValue(totals[c])) return csvEscape(Number(totals[c]).toFixed(2));
        return csvEscape(idx === 0 ? "TOTAL" : "");
      });
      lines.push(totRow.join(","));
    }
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "").replace("T", "_");
  const file = `${fileBase || "lgu_report"}_${stamp}.csv`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return file;
}

export default function LguReportsPage() {
  // Top-level tab
  const [tab, setTab] = useState<"vendor" | "driver">("vendor");

  // Vendor controls
  const [vendorView, setVendorView] = useState<"monthly" | "summary">("monthly");
  const [vendorMonth, setVendorMonth] = useState<string>(""); // YYYY-MM
  const [vendorId, setVendorId] = useState<string>("");

  // Driver controls
  const [driverView, setDriverView] = useState<"daily" | "requests">("daily");
  const [driverId, setDriverId] = useState<string>("");

  // Shared
  const [query, setQuery] = useState<string>(""); // broad search across row JSON
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  // restore
  useEffect(() => {
    try {
      const t = localStorage.getItem("lgu_reports_tab");
      const vv = localStorage.getItem("lgu_vendor_view");
      const vm = localStorage.getItem("lgu_vendor_month");
      const vid = localStorage.getItem("lgu_vendor_id");
      const dv = localStorage.getItem("lgu_driver_view");
      const did = localStorage.getItem("lgu_driver_id");
      const q = localStorage.getItem("lgu_query");

      if (t === "vendor" || t === "driver") setTab(t);
      if (vv === "monthly" || vv === "summary") setVendorView(vv);
      if (vm) setVendorMonth(vm);
      if (vid) setVendorId(vid);
      if (dv === "daily" || dv === "requests") setDriverView(dv);
      if (did) setDriverId(did);
      if (q) setQuery(q);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("lgu_reports_tab", tab);
      localStorage.setItem("lgu_vendor_view", vendorView);
      localStorage.setItem("lgu_vendor_month", vendorMonth || "");
      localStorage.setItem("lgu_vendor_id", vendorId || "");
      localStorage.setItem("lgu_driver_view", driverView);
      localStorage.setItem("lgu_driver_id", driverId || "");
      localStorage.setItem("lgu_query", query || "");
    } catch {}
  }, [tab, vendorView, vendorMonth, vendorId, driverView, driverId, query]);

  async function load() {
    setLoading(true);
    setBanner(null);

    try {
      let url = "";

      if (tab === "vendor") {
        const qs = new URLSearchParams();
        qs.set("view", vendorView);
        qs.set("limit", "500");
        if (vendorId.trim()) qs.set("vendor_id", vendorId.trim());
        if (vendorView === "monthly") {
          const ms = toMonthStart(vendorMonth);
          if (ms) qs.set("month_start", ms);
        }
        url = `/api/admin/reports/lgu-vendor?${qs.toString()}`;
      } else {
        const qs = new URLSearchParams();
        qs.set("view", driverView);
        qs.set("limit", "500");
        if (driverView === "requests" && driverId.trim()) qs.set("driver_id", driverId.trim());
        url = `/api/admin/reports/lgu-driver?${qs.toString()}`;
      }

      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = data?.message || data?.error || data?.details || "Failed to load report";
        throw new Error(String(msg));
      }

      setRows(Array.isArray(data) ? data : []);
      setBanner({ kind: "ok", text: `Loaded ${Array.isArray(data) ? data.length : 0} row(s).` });
    } catch (e: any) {
      setRows([]);
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      try {
        const s = JSON.stringify(r || {}).toLowerCase();
        return s.includes(q);
      } catch {
        return false;
      }
    });
  }, [rows, query]);

  const columns = useMemo(() => {
    if (!filtered.length) return [] as string[];
    const first = filtered[0] || {};
    const keys = Object.keys(first);

    // Mild preference for readability if present
    const preferred = tab === "vendor"
      ? (vendorView === "monthly"
          ? ["vendor_id","month_start","total_billings","total_platform_fees","total_vendor_earnings","total_payouts"]
          : ["vendor_id","total_billings","total_platform_fees","total_vendor_earnings","wallet_balance","last_payout_at","last_payout_amount"])
      : (driverView === "requests"
          ? ["id","driver_id","amount","status","requested_at","processed_at"]
          : ["driver_id"]);

    const out: string[] = [];
    for (const p of preferred) if (keys.includes(p)) out.push(p);
    for (const k of keys) if (!out.includes(k)) out.push(k);
    return out;
  }, [filtered, tab, vendorView, driverView]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of columns) t[c] = 0;
    for (const r of filtered) {
      for (const c of columns) {
        const v = r?.[c];
        if (isNumericValue(v)) t[c] += Number(v);
      }
    }
    return t;
  }, [filtered, columns]);

  function exportCsv() {
    if (!columns.length) {
      setBanner({ kind: "warn", text: "No rows to export." });
      return;
    }

    const base =
      tab === "vendor"
        ? `lgu_vendor_${vendorView}`
        : `lgu_driver_${driverView}`;

    const file = downloadCsvGeneric(columns, filtered, totals, base);
    setBanner({ kind: "ok", text: "CSV downloaded: " + file });
  }

  const btn: any = {
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "white",
    cursor: "pointer",
    fontSize: 12,
  };
  const btnDisabled: any = { ...btn, opacity: 0.5, cursor: "not-allowed" };

  const bannerStyle = (k: "ok" | "warn" | "err") =>
    ({
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #e5e7eb",
      marginTop: 12,
      background: k === "ok" ? "#ecfdf5" : k === "warn" ? "#fffbeb" : "#fef2f2",
      color: k === "ok" ? "#065f46" : k === "warn" ? "#92400e" : "#991b1b",
      fontSize: 14,
      maxWidth: 1200,
      whiteSpace: "pre-wrap",
    } as any);

  return (
    <div style={{ padding: 16 }}>
      clearly a safe, read-only export page for LGU/accounting.
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>LGU / Accounting Exports (Read-only)</h1>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button style={tab === "vendor" ? btn : btn} onClick={() => setTab("vendor")}>Vendor</button>
        <button style={tab === "driver" ? btn : btn} onClick={() => setTab("driver")}>Driver</button>

        <span style={{ opacity: 0.6 }}>|</span>

        {tab === "vendor" ? (
          <>
            <label>
              View:&nbsp;
              <select value={vendorView} onChange={(e) => setVendorView(e.target.value as any)}>
                <option value="monthly">monthly</option>
                <option value="summary">summary</option>
              </select>
            </label>

            <label style={{ opacity: vendorView === "monthly" ? 1 : 0.5 }}>
              Month:&nbsp;
              <input
                type="month"
                value={vendorMonth}
                onChange={(e) => setVendorMonth(e.target.value)}
                disabled={vendorView !== "monthly"}
              />
            </label>

            <label>
              Vendor ID:&nbsp;
              <input
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                placeholder="optional vendor UUID"
                style={{ width: 310 }}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              View:&nbsp;
              <select value={driverView} onChange={(e) => setDriverView(e.target.value as any)}>
                <option value="daily">daily</option>
                <option value="requests">payout_requests</option>
              </select>
            </label>

            <label style={{ opacity: driverView === "requests" ? 1 : 0.5 }}>
              Driver ID:&nbsp;
              <input
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                placeholder="optional driver UUID (requests view only)"
                disabled={driverView !== "requests"}
                style={{ width: 360 }}
              />
            </label>
          </>
        )}

        <span style={{ opacity: 0.6 }}>|</span>

        <label>
          Search:&nbsp;
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter within loaded rows..."
            style={{ width: 320 }}
          />
        </label>

        <button style={loading ? btnDisabled : btn} disabled={loading} onClick={load}>Refresh</button>
        <button style={(!filtered.length || loading) ? btnDisabled : btn} disabled={!filtered.length || loading} onClick={exportCsv}>Export CSV</button>
        {loading ? <span style={{ opacity: 0.7 }}>Loading...</span> : null}
      </div>

      {banner ? <div style={bannerStyle(banner.kind)}>{banner.text}</div> : null}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>{c}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((r, idx) => (
              <tr key={String(r?.id ?? "") + ":" + idx}>
                {columns.map((c) => {
                  const v = r?.[c];
                  const txt = (typeof v === "number") ? fmtNum(v) : String(v ?? "");
                  const mono = c.endsWith("_id") || c === "id" || c.endsWith("_at");
                  return (
                    <td key={c} style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: mono ? "monospace" : "inherit" }}>
                      {txt}
                    </td>
                  );
                })}
              </tr>
            ))}

            {filtered.length === 0 ? (
              <tr><td colSpan={Math.max(columns.length, 1)} style={{ padding: 12, color: "#666" }}>No rows.</td></tr>
            ) : null}

            {filtered.length > 0 ? (
              <tr>
                {columns.map((c, i) => {
                  const sum = totals[c];
                  const show = Number.isFinite(sum) && sum !== 0;
                  const label = i === 0 ? "TOTAL" : "";
                  const txt = show ? sum.toFixed(2) : label;
                  return (
                    <td key={"tot:" + c} style={{ padding: 8, borderTop: "2px solid #ddd", fontWeight: 700 }}>
                      {txt}
                    </td>
                  );
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        Locked rule: read-only exports. No payout status updates. No wallet mutations. No schema changes.
      </div>
    </div>
  );
}