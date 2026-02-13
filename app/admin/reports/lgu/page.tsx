"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export const dynamic = "force-dynamic";

type AnyRow = Record<string, any>;
type Banner = { kind: "ok" | "warn" | "err"; text: string } | null;

function sha256Hex(buf: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", buf).then((hash) => {
    const bytes = Array.from(new Uint8Array(hash));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  });
}

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 320) return raw.slice(0, 320) + "...";
  return raw;
}

function toMonthStart(m: string): string {
  if (!m || m.length < 7) return "";
  return m + "-01";
}

function isNum(v: any): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.trim() !== "" && Number.isFinite(Number(v));
  return false;
}

function fmt(v: any) {
  return isNum(v) ? Number(v).toFixed(2) : String(v ?? "");
}

function csvEscape(v: any): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Tab = "vendor" | "driver";
type VendorView = "monthly" | "summary";
type DriverView = "daily" | "requests";

function safeTab(v: any): Tab | null {
  const s = String(v || "").toLowerCase().trim();
  if (s === "vendor") return "vendor";
  if (s === "driver") return "driver";
  return null;
}
function safeVendorView(v: any): VendorView | null {
  const s = String(v || "").toLowerCase().trim();
  if (s === "monthly") return "monthly";
  if (s === "summary") return "summary";
  return null;
}
function safeDriverView(v: any): DriverView | null {
  const s = String(v || "").toLowerCase().trim();
  if (s === "daily") return "daily";
  if (s === "requests") return "requests";
  return null;
}
function safeMonth(v: any): string {
  const s = String(v || "").trim();
  // Accept YYYY-MM only
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return "";
}

export default function LguReportsPage() {
  const [tab, setTab] = useState<Tab>("vendor");

  const [vendorView, setVendorView] = useState<VendorView>("monthly");
  const [vendorMonth, setVendorMonth] = useState<string>("");
  const [vendorId, setVendorId] = useState<string>("");

  const [driverView, setDriverView] = useState<DriverView>("daily");
  const [driverId, setDriverId] = useState<string>("");

  const [rows, setRows] = useState<AnyRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const [exportInfo, setExportInfo] = useState<any>(null);
  const [checksum, setChecksum] = useState<string | null>(null);

  const didInitFromUrl = useRef(false);

  // 10C: Apply presets from URL query (client-side, no useSearchParams)
  useEffect(() => {
    if (didInitFromUrl.current) return;
    didInitFromUrl.current = true;

    if (typeof window === "undefined") return;

    const sp = new URLSearchParams(window.location.search);

    const pTab = safeTab(sp.get("tab"));
    const pView = sp.get("view");
    const pMonth = safeMonth(sp.get("month"));
    const pVendor = String(sp.get("vendor_id") || "").trim();
    const pDriver = String(sp.get("driver_id") || "").trim();

    if (pTab) setTab(pTab);

    if (pTab === "vendor") {
      const vv = safeVendorView(pView);
      if (vv) setVendorView(vv);
      if (pMonth) setVendorMonth(pMonth);
      if (pVendor) setVendorId(pVendor);
    }

    if (pTab === "driver") {
      const dv = safeDriverView(pView);
      if (dv) setDriverView(dv);
      if (pDriver) setDriverId(pDriver);
    }
  }, []);

  async function load() {
    setLoading(true);
    setBanner(null);
    setExportInfo(null);
    setChecksum(null);

    try {
      let url = "";
      if (tab === "vendor") {
        const qs = new URLSearchParams();
        qs.set("view", vendorView);
        qs.set("limit", "500");
        if (vendorId) qs.set("vendor_id", vendorId);
        if (vendorView === "monthly") {
          const ms = toMonthStart(vendorMonth);
          if (ms) qs.set("month_start", ms);
        }
        url = "/api/admin/reports/lgu-vendor?" + qs.toString();
      } else {
        const qs = new URLSearchParams();
        qs.set("view", driverView);
        qs.set("limit", "500");
        if (driverView === "requests" && driverId) qs.set("driver_id", driverId);
        url = "/api/admin/reports/lgu-driver?" + qs.toString();
      }

      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || "Load failed");

      const arr = Array.isArray(data) ? data : [];
      setRows(arr);
      setBanner({ kind: "ok", text: `Loaded ${arr.length} row(s).` });
    } catch (e: any) {
      setRows([]);
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  // Load on change of view params (GET only)
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, vendorView, vendorMonth, vendorId, driverView, driverId]);

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, query]);

  const columns = useMemo(() => {
    if (!filtered.length) return [];
    return Object.keys(filtered[0] || {});
  }, [filtered]);

  async function exportCsv() {
    if (!filtered.length) return;

    const now = new Date();
    const stamp = now.toISOString().replace(/[:T]/g, "").slice(0, 15);

    const base =
      tab === "vendor"
        ? `LGU_VENDOR_${vendorView.toUpperCase()}`
        : `LGU_DRIVER_${driverView.toUpperCase()}`;

    const file =
      tab === "vendor" && vendorView === "monthly" && vendorMonth
        ? `${base}_${vendorMonth}_${stamp}.csv`
        : `${base}_${stamp}.csv`;

    const lines = [
      columns.join(","),
      ...filtered.map((r) => columns.map((c) => csvEscape(r[c])).join(",")),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const buf = await blob.arrayBuffer();
    const hash = await sha256Hex(buf);

    setChecksum(hash);
    setExportInfo({
      file,
      rows: filtered.length,
      time: now.toISOString(),
      tab,
      view: tab === "vendor" ? vendorView : driverView,
      vendor_id: tab === "vendor" ? (vendorId || null) : null,
      driver_id: tab === "driver" ? (driverId || null) : null,
      month: tab === "vendor" && vendorView === "monthly" ? (vendorMonth || null) : null,
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    a.click();
    URL.revokeObjectURL(url);

    setBanner({ kind: "ok", text: `Exported ${file}` });
  }

  const btn: any = {
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 10,
    background: "white",
    cursor: "pointer",
    fontSize: 12,
    display: "inline-block",
  };
  const btnDisabled: any = { ...btn, opacity: 0.5, cursor: "not-allowed" };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ margin: 0 }}>LGU / Accounting Exports (Read-only)</h1>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
        Presets via URL query (10C). GET-only. CSV generated client-side.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Tab:</span>
        <button style={btn} onClick={() => setTab("vendor")}>Vendor</button>
        <button style={btn} onClick={() => setTab("driver")}>Driver</button>

        <span style={{ opacity: 0.4 }}>|</span>

        {tab === "vendor" ? (
          <>
            <span style={{ fontSize: 12, opacity: 0.8 }}>View:</span>
            <button style={btn} onClick={() => setVendorView("monthly")}>Monthly</button>
            <button style={btn} onClick={() => setVendorView("summary")}>Summary</button>

            {vendorView === "monthly" ? (
              <>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Month:</span>
                <input
                  value={vendorMonth}
                  onChange={(e) => setVendorMonth(safeMonth(e.target.value))}
                  placeholder="YYYY-MM"
                  style={{ width: 110 }}
                />
              </>
            ) : null}

            <span style={{ fontSize: 12, opacity: 0.8 }}>Vendor ID:</span>
            <input
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              placeholder="optional"
              style={{ width: 180 }}
            />
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, opacity: 0.8 }}>View:</span>
            <button style={btn} onClick={() => setDriverView("daily")}>Daily</button>
            <button style={btn} onClick={() => setDriverView("requests")}>Payout Requests</button>

            {driverView === "requests" ? (
              <>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Driver ID:</span>
                <input
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  placeholder="optional"
                  style={{ width: 180 }}
                />
              </>
            ) : null}
          </>
        )}

        <span style={{ opacity: 0.4 }}>|</span>

        <button style={loading ? btnDisabled : btn} disabled={loading} onClick={load}>
          Refresh
        </button>
        <button style={!filtered.length ? btnDisabled : btn} disabled={!filtered.length} onClick={exportCsv}>
          Export CSV
        </button>

        <span style={{ fontSize: 12, opacity: 0.75 }}>
          Rows: <b>{filtered.length}</b>
        </span>

        <span style={{ fontSize: 12, opacity: 0.75 }}>
          Search:&nbsp;
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter..."
            style={{ width: 240 }}
          />
        </span>
      </div>

      {banner && <div style={{ marginTop: 10 }}>{banner.text}</div>}

      {exportInfo && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          <b>Export Summary</b>
          <pre style={{ margin: "8px 0", fontSize: 12 }}>{JSON.stringify(exportInfo, null, 2)}</pre>
          <b>SHA-256</b>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ fontSize: 12 }}>{checksum}</code>
            <button style={btn} onClick={() => navigator.clipboard.writeText(checksum || "")}>Copy</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table border={1} cellPadding={6} style={{ marginTop: 12, width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => <td key={c}>{fmt(r[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 10, opacity: 0.6 }}>
        Locked rule: read-only exports. GET only. No wallet mutations. No payout updates.
      </p>
    </div>
  );
}
