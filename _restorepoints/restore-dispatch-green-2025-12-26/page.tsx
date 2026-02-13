"use client";

/* JRIDE_UI_COPY_HELPERS_START */
function copyToClipboard(text: string) {
  try {
    const t = String(text || "").trim();
    if (!t) return;
    navigator.clipboard.writeText(t);
  } catch {}
}
/* JRIDE_UI_COPY_HELPERS_END */

import React, { useEffect, useMemo, useState } from "react";

type Booking = {
  id: string;
  booking_code?: string | null;
  town?: string | null;
  status?: string | null;
  trip_type?: string | null;

  created_at?: string | null;

  // Stored columns (may exist depending on API select)
  from_label?: string | null;
  to_label?: string | null;
  verified_fare?: number | null;
  passenger_fare_response?: any;

  // Derived report fields (from enriched API)
  pickup_label?: string | null;
  dropoff_label?: string | null;
  distance_km?: number | null;
  fare?: number | null;
};

type AckState =
  | { state: "idle" }
  | { state: "pending"; at: number }
  | { state: "ok"; at: number; actionId?: string; msg?: string }
  | { state: "err"; at: number; msg: string; httpStatus?: number };

function normStatus(s?: string | null) {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return "";
  if (v === "new") return "pending";
  if (v === "enroute") return "on_the_way";
  if (v === "ongoing") return "on_trip";
  return v;
}

function allowedActions(status?: string | null) {
  const s = normStatus(status);
  if (s === "completed" || s === "cancelled") return [] as string[];
  if (s === "pending") return ["assigned", "cancelled"];
  if (s === "assigned") return ["on_the_way", "cancelled"];
  if (s === "on_the_way") return ["on_trip", "cancelled"];
  if (s === "on_trip") return ["completed", "cancelled"];
  if (s === "arrived") return ["completed", "cancelled"];
  return ["cancelled"];
}

async function postJson(url: string, body: any, headers?: Record<string, string>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String(j?.message || j?.error || j?.code || "REQUEST_FAILED");
    const err: any = new Error(msg);
    err.httpStatus = r.status;
    err.payload = j;
    throw err;
  }
  return j;
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, any>[], columns: string[]) {
  const head = columns.map(csvEscape).join(",");
  const lines = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(","));
  return [head, ...lines].join("\r\n");
}

function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19);
  return { date, time };
}

function pickTown(t?: string | null) {
  const v = String(t || "").trim();
  if (!v) return "Unknown";
  const u = v.toLowerCase();
  if (u === "lagawe") return "Lagawe";
  if (u === "kiangan") return "Kiangan";
  if (u === "hingyon") return "Hingyon";
  if (u === "lamut") return "Lamut";
  if (u === "banaue") return "Banaue";
  return v;
}

function to2(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "N/A";
  return x.toFixed(2);
}

function isLguComplete(b: Booking) {
  const hasFrom = Boolean(String(b.pickup_label ?? b.from_label ?? "").trim());
  const hasTo = Boolean(String(b.dropoff_label ?? b.to_label ?? "").trim());
  const hasFare = Number.isFinite(Number(b.fare ?? b.verified_fare));
  const hasDist = Number.isFinite(Number(b.distance_km));
  return hasFrom && hasTo && hasFare && hasDist;
}

/**
 * SpreadsheetML (Excel XML) multi-sheet generator.
 * No dependencies. Excel opens it directly.
 */
function xmlEscape(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeSpreadsheetML(sheets: { name: string; rows: Record<string, any>[]; cols: string[] }[]) {
  const header =
    `<?xml version="1.0"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"` +
    ` xmlns:o="urn:schemas-microsoft-com:office:office"` +
    ` xmlns:x="urn:schemas-microsoft-com:office:excel"` +
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`;

  const styles =
    `<Styles>` +
    `<Style ss:ID="h"><Font ss:Bold="1"/></Style>` +
    `</Styles>`;

  const ws = sheets
    .map((sh) => {
      const tableRows: string[] = [];

      // header row
      tableRows.push(
        `<Row>` +
          sh.cols.map((c) => `<Cell ss:StyleID="h"><Data ss:Type="String">${xmlEscape(c)}</Data></Cell>`).join("") +
        `</Row>`
      );

      // data rows
      for (const r of sh.rows) {
        tableRows.push(
          `<Row>` +
            sh.cols
              .map((c) => {
                const v = r[c];
                // keep as String for safety (LGU printing); Excel still formats numeric-looking cells
                return `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
              })
              .join("") +
          `</Row>`
        );
      }

      return (
        `<Worksheet ss:Name="${xmlEscape(sh.name)}">` +
          `<Table>` +
            tableRows.join("") +
          `</Table>` +
        `</Worksheet>`
      );
    })
    .join("");

  return header + styles + ws + `</Workbook>`;
}

export default function DispatchPage() {
  const [rows, setRows] = useState<Booking[]>([]);
  const [ackMap, setAckMap] = useState<Record<string, AckState>>({});
  const [obs, setObs] = useState<any[]>([]);
  const [lastLoadAt, setLastLoadAt] = useState<number>(0);

  const [dispatcherName, setDispatcherName] = useState<string>("");

  /* JRIDE_UI_SEARCH_START */
  const [searchQ, setSearchQ] = useState<string>("");
  /* JRIDE_UI_SEARCH_END */

  // LGU export controls
  const MUNICIPALITIES = ["All", "Kiangan", "Lagawe", "Hingyon", "Lamut", "Banaue"] as const;
  const [muniFilter, setMuniFilter] = useState<(typeof MUNICIPALITIES)[number]>("All");
  const [completedOnly, setCompletedOnly] = useState<boolean>(true);

  
  // Date range filter (LGU exports only; no DB changes)
  type DateRangeMode = "today" | "week" | "custom";
  const [rangeMode, setRangeMode] = useState<DateRangeMode>("week");
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfToday() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }

  function startOfWeekMonday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1) - day; // Monday start
    d.setDate(d.getDate() + diff);
    return d;
  }

  function getRangeOrNull() {
    if (rangeMode === "today") return { from: startOfToday(), to: endOfToday() };
    if (rangeMode === "week") return { from: startOfWeekMonday(), to: endOfToday() };
    if (rangeMode === "custom") {
      if (!rangeFrom || !rangeTo) return null;
      return {
        from: new Date(rangeFrom + "T00:00:00"),
        to: new Date(rangeTo + "T23:59:59"),
      };
    }
    return null;
  }
// LGU Fixer modal
  const [fixOpen, setFixOpen] = useState(false);
  const [fixTarget, setFixTarget] = useState<Booking | null>(null);
  const [fixFrom, setFixFrom] = useState("");
  const [fixTo, setFixTo] = useState("");
  const [fixDist, setFixDist] = useState("");
  const [fixFare, setFixFare] = useState("");
  const [fixToken, setFixToken] = useState("");
  const [fixMsg, setFixMsg] = useState<string>("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("JRIDE_DISPATCHER_NAME");
      if (saved) setDispatcherName(saved);
      const tok = localStorage.getItem("JRIDE_DISPATCH_ADMIN_TOKEN");
      if (tok) setFixToken(tok);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("JRIDE_DISPATCHER_NAME", dispatcherName);
    } catch {}
  }, [dispatcherName]);

  useEffect(() => {
    try {
      localStorage.setItem("JRIDE_DISPATCH_ADMIN_TOKEN", fixToken);
    } catch {}
  }, [fixToken]);

  async function load() {
    const r = await fetch("/api/dispatch/bookings", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setRows((j.rows || []).filter(Boolean));
    setLastLoadAt(Date.now());
  }

  async function loadObs() {
    const r = await fetch("/api/dispatch/status?log=1", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (j?.ok && Array.isArray(j.actions)) setObs(j.actions);
  }

  useEffect(() => {
    load().catch(() => {});
    loadObs().catch(() => {});
    const t = setInterval(() => {
      load().catch(() => {});
      loadObs().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  function keyOf(b: Booking) {
    return String(b.booking_code || b.id);
  }

  function setAck(key: string, next: AckState) {
    setAckMap((m) => ({ ...m, [key]: next }));
  }

  async function setStatus(b: Booking, nextStatus: string) {
    const key = keyOf(b);
    setAck(key, { state: "pending", at: Date.now() });

    try {
      const headers: Record<string, string> = {};
      if (dispatcherName && dispatcherName.trim()) headers["x-dispatcher-name"] = dispatcherName.trim();

      const j = await postJson("/api/dispatch/status", { bookingId: String(b.id), status: nextStatus }, headers);

      setAck(key, { state: "ok", at: Date.now(), actionId: j?.actionId, msg: "ACK: " + nextStatus });

      await load();
      await loadObs();

      setTimeout(() => {
        setAckMap((m) => {
          const cur = m[key];
          if (cur && cur.state === "ok") return { ...m, [key]: { state: "idle" } };
          return m;
        });
      }, 1500);
    } catch (e: any) {
      const msg = String(e?.message || "REJECTED");
      setAck(key, { state: "err", at: Date.now(), msg: "REJECT: " + msg, httpStatus: e?.httpStatus });

      setTimeout(() => {
        setAckMap((m) => {
          const cur = m[key];
          if (cur && cur.state === "err") return { ...m, [key]: { state: "idle" } };
          return m;
        });
      }, 4000);

      loadObs().catch(() => {});
    }
  }
  // rowsSorted derived safely (no hook)
  const rowsSorted = [...((rows as any) || [])];
const rowsForExport = useMemo(() => {
    const wantedStatus = completedOnly ? "completed" : null;
    
    const range = getRangeOrNull();
return rowsSorted.filter((b) => {
      const town = pickTown(b.town);
      const s = normStatus(b.status);
      if (wantedStatus && s !== wantedStatus) return false;
      if (muniFilter !== "All" && town !== muniFilter) return false;
      if (range) {
        if (!b.created_at) return false;
        const d = new Date(b.created_at);
        if (Number.isNaN(d.getTime())) return false;
        if (d < range.from || d > range.to) return false;
      }
return true;
    });
  }, [rowsSorted, muniFilter, completedOnly]);

  function buildLguRows(input: Booking[]) {
    return input.map((b) => {
      const { date, time } = fmtDateTime(b.created_at || null);
      const town = pickTown(b.town);

      const pickup = String(b.pickup_label ?? b.from_label ?? "").trim() || "N/A";
      const dropoff = String(b.dropoff_label ?? b.to_label ?? "").trim() || "N/A";

      const dist = Number.isFinite(Number(b.distance_km)) ? to2(b.distance_km) : "N/A";
      const fare = Number.isFinite(Number(b.fare ?? b.verified_fare)) ? to2(b.fare ?? b.verified_fare) : "N/A";

      return {
        Date: date || "N/A",
        Time: time || "N/A",
        Municipality: town,
        Origin_Pickup: pickup,
        Destination_Dropoff: dropoff,
        Distance_km: dist,
        Fare_php: fare,
        Booking_code: b.booking_code || "N/A",
        Trip_type: b.trip_type || "N/A",
        Status: normStatus(b.status) || "N/A",
        Dispatcher: dispatcherName?.trim() ? dispatcherName.trim() : "N/A",
      };
    });
  }

  const LGU_COLS = [
    "Date",
    "Time",
    "Municipality",
    "Origin_Pickup",
    "Destination_Dropoff",
    "Distance_km",
    "Fare_php",
    "Booking_code",
    "Trip_type",
    "Status",
    "Dispatcher",
  ];

  function exportLguCsv() {
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10);
    const muni = muniFilter === "All" ? "ALL" : muniFilter.toUpperCase();
    const filename = `JRIDE_LGU_TRIP_LEDGER_${ymd}_${muni}.csv`;

    const normalized = buildLguRows(rowsForExport);
    const csv = toCsv(normalized, LGU_COLS);
    downloadText(filename, csv);
  }

  function exportLguExcel() {
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10);
    const SUMMARY_COLS = ["Municipality","Trips","Total_km","Total_fare_php","Avg_km","Avg_fare_php"];

    const sum2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");

    const buildSummary = () => {
      const townsList = ["Kiangan", "Lagawe", "Hingyon", "Lamut", "Banaue"];
      const base = rowsSorted.filter((b) => {
        const s = normStatus(b.status);
        if (completedOnly && s !== "completed") return false;
        return true;
      });

      const calcFor = (townName: string | null) => {
        const items = townName ? base.filter((b) => pickTown(b.town) === townName) : base;

        let trips = 0;
        let totalKm = 0;
        let totalFare = 0;

        for (const b of items) {
          trips += 1;

          const km = Number(b.distance_km);
          if (Number.isFinite(km)) totalKm += km;

          const fare = Number(b.fare ?? b.verified_fare);
          if (Number.isFinite(fare)) totalFare += fare;
        }

        const avgKm = trips > 0 ? totalKm / trips : 0;
        const avgFare = trips > 0 ? totalFare / trips : 0;

        return {
          Municipality: townName || "ALL",
          Trips: String(trips),
          Total_km: sum2(totalKm),
          Total_fare_php: sum2(totalFare),
          Avg_km: sum2(avgKm),
          Avg_fare_php: sum2(avgFare),
        };
      };

      const rows = [ calcFor(null), ...townsList.map((t) => calcFor(t)) ];
      return { name: "SUMMARY", rows, cols: SUMMARY_COLS };
    };



    const towns = ["Kiangan", "Lagawe", "Hingyon", "Lamut", "Banaue"];

    const makeSheet = (name: string, filterTown?: string) => {
      const base = rowsSorted.filter((b) => {
        const s = normStatus(b.status);
        if (completedOnly && s !== "completed") return false;
        if (!filterTown) return true;
        return pickTown(b.town) === filterTown;
      });
      return { name, rows: buildLguRows(base), cols: LGU_COLS };
    };

    const sheets = [
      buildSummary(),
      makeSheet("ALL", undefined),
      ...towns.map((t) => makeSheet(t, t)),
    ];

    const xml = makeSpreadsheetML(sheets);
    const filename = `JRIDE_LGU_TRIP_LEDGER_${ymd}_MULTI-SHEET.xls`;
    downloadText(filename, xml, "application/vnd.ms-excel");
  }

  function exportActionsCsv() {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `dispatch-actions-${stamp}.csv`;

    const normalized = (obs || []).map((a: any) => ({
      at: a.at || "",
      type: a.type || "",
      booking: a.bookingCode || a.bookingId || "",
      nextStatus: a.nextStatus || "",
      driverId: a.driverId || "",
      result: a.ok ? (a.code === "FORCE_OK" ? "FORCE" : "OK") : "BLOCKED",
      code: a.code || "",
      message: a.message || "",
      actor: a.actor || "",
      ip: a.ip || "",
      httpStatus: a.httpStatus || "",
      id: a.id || "",
    }));

    const cols = ["at","type","booking","nextStatus","driverId","result","code","message","actor","ip","httpStatus","id"];
    downloadText(filename, toCsv(normalized, cols));
  }

  function openFixer(b: Booking) {
    setFixTarget(b);
    setFixFrom(String(b.pickup_label ?? b.from_label ?? "").trim());
    setFixTo(String(b.dropoff_label ?? b.to_label ?? "").trim());
    setFixDist(Number.isFinite(Number(b.distance_km)) ? String(b.distance_km) : "");
    setFixFare(Number.isFinite(Number(b.fare ?? b.verified_fare)) ? String(b.fare ?? b.verified_fare) : "");
    setFixMsg("");
    setFixOpen(true);
  }

  async function saveFixer() {
    if (!fixTarget) return;
    if (!fixToken.trim()) {
      setFixMsg("Missing token. Set DISPATCH_ADMIN_TOKEN on Vercel and paste it here.");
      return;
    }

    const payload: any = {
      bookingId: fixTarget.id,
      from_label: fixFrom,
      to_label: fixTo,
    };

    const d = Number(fixDist);
    if (Number.isFinite(d)) payload.distance_km = d;

    const f = Number(fixFare);
    if (Number.isFinite(f)) payload.verified_fare = f;

    try {
      setFixMsg("Saving...");
      await postJson("/api/dispatch/lgu", payload, { "x-dispatch-admin-token": fixToken.trim() });
      setFixMsg("Saved OK");
      await load();
      setTimeout(() => setFixOpen(false), 700);
    } catch (e: any) {
      setFixMsg("Failed: " + String(e?.message || "ERROR"));
    }
  }

  const incompleteCount = useMemo(() => {
    return rowsForExport.filter((b) => !isLguComplete(b)).length;
  }, [rowsForExport]);

    // UI_POLISH_BLOCK_START
  // --- UI: Operator bar + Missing LGU workflow ---
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [missingJumpIdx, setMissingJumpIdx] = useState(0);
  const [focusBookingId, setFocusBookingId] = useState<string | null>(null);
  // Use existing missingForExport if present; else compute from rowsForExport + isLguComplete
  const computedMissing = useMemo(() => {
    try {
      // @ts-ignore
      if (typeof missingForExport !== "undefined" && Array.isArray(missingForExport)) return missingForExport;
    } catch {}
    return (rowsForExport || []).filter((b) => {
      try { return !isLguComplete(b); } catch { return false; }
    });
  }, [rowsForExport]);

  const rowsUi = useMemo(
    () => (showMissingOnly ? computedMissing : rowsForExport),
    [showMissingOnly, computedMissing, rowsForExport]
  );

  const missingCountUi = computedMissing.length;

  useEffect(() => {
    if (!focusBookingId) return;
    try {
      const el = document.querySelector(`[data-booking-id="${focusBookingId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {}
  }, [focusBookingId]);

  function jumpToNextMissing() {
    if (!computedMissing.length) return;
    const i = missingJumpIdx % computedMissing.length;
    const b = computedMissing[i];
    setMissingJumpIdx(i + 1);
    setFocusBookingId(String((b).id || (b).uuid || (b).booking_code || ""));
  }
  // UI_POLISH_BLOCK_END
return (
    <div className="p-4 space-y-4">
      {/* UI: Operator Bar */}
      <div className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">Dispatcher:</span>
            <span className="font-mono">{dispatcherName?.trim() ? dispatcherName.trim() : "N/A"}</span>

            <span className="opacity-50">|</span>

            <span className="font-semibold">Municipality:</span>
            <span>{muniFilter}</span>

            <span className="opacity-50">|</span>

            <span className="font-semibold">Range:</span>
            <span>{String(rangeMode || "")}</span>

            <span className="opacity-50">|</span>

            <span className="font-semibold">Completed:</span>
            <span>{completedOnly ? "YES" : "NO"}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm">
              <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-800">
                Missing LGU: {missingCountUi}
              </span>
            </div><button
              type="button"
              className="rounded-md border px-2 py-1 text-sm hover:bg-slate-50"
              onClick={() => setShowMissingOnly((v) => !v)}
              title="Toggle missing-only rows"
            >
              {showMissingOnly ? "Showing: Missing only" : "Showing: All"}
              {missingCountUi > 0 ? (
                <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs">{missingCountUi}</span>
              ) : null}
            </button>

            <button
              type="button"
              className="rounded-md border px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              onClick={jumpToNextMissing}
              disabled={!missingCountUi}
              title={missingCountUi ? "Jump to next missing LGU row" : "No missing LGU rows"}
            >
              Next missing
            </button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dispatch</h1>
          <div className="text-xs text-slate-600">
            Parity vocab: pending - assigned - on_the_way - on_trip - completed (+ cancelled)
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs text-slate-600">
            Auto-refresh: 5s - Last load: {lastLoadAt ? new Date(lastLoadAt).toLocaleTimeString() : "-"}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Dispatcher</span>
            <input
              value={dispatcherName}
              onChange={(e) => setDispatcherName(e.target.value)}
              placeholder="name"
              className="h-8 w-44 rounded border px-2 text-sm"
            />            <div className="flex items-center gap-2 ml-3">
              <span className="text-xs text-slate-600">Search</span>
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="booking / phone / status / town"
                className="h-8 w-60 rounded border px-2 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* LGU Export Bar */}
      <div className="rounded border p-3 flex flex-wrap items-center gap-3">
        <div className="font-semibold text-sm">LGU Trip Ledger</div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">Municipality</span>
          <select
            className="h-8 rounded border px-2 text-sm"
            value={muniFilter}
            onChange={(e) => setMuniFilter(e.target.value as any)}
          >
            {MUNICIPALITIES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">Date range</span>
          <select
            className="h-8 rounded border px-2 text-sm"
            value={rangeMode}
            onChange={(e) => setRangeMode(e.target.value as any)}
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {rangeMode === "custom" ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="h-8 rounded border px-2 text-sm"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
            />
            <span className="text-xs text-slate-500">to</span>
            <input
              type="date"
              className="h-8 rounded border px-2 text-sm"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
            />
          </div>
        ) : null}


        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={completedOnly}
            onChange={(e) => setCompletedOnly(e.target.checked)}
          />
          <span className="text-xs text-slate-600">Completed only (default)</span>
        </label>

        <div className="text-xs text-slate-500">
          Rows: {rowsForExport.length}
          {incompleteCount > 0 ? (
            <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
              Incomplete LGU rows: {incompleteCount}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          className="ml-auto text-xs rounded border px-3 py-2 hover:bg-slate-50"
          onClick={exportLguCsv}
          title="Downloads CSV that opens in Excel (LGU monitoring fields)"
        >
          Download LGU CSV
        </button>

        <button
          type="button"
          className="text-xs rounded border px-3 py-2 hover:bg-slate-50"
          onClick={exportLguExcel}
          title="Downloads Excel multi-sheet file (ALL + per municipality)"
        >
          Download LGU Excel
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded border">
          <div className="p-3 border-b font-semibold">Bookings</div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b">
                <tr className="text-left">
                  <th className="p-2">Booking</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Acknowledgement</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rowsSorted.length === 0 ? (
                  <tr>
                    <td className="p-3 text-slate-600" colSpan={4}>
                      No rows from /api/dispatch/bookings
                    </td>
                  </tr>
                ) : (
                  rowsForExport.map((b) => {
                    const key = keyOf(b);
                    const s = normStatus(b.status);
                    const acts = allowedActions(s);
                    const ack = ackMap[key] || { state: "idle" };
                    const isPending = ack.state === "pending";

                    const lguOk = isLguComplete(b);

                    function Btn(label: string, action: string, onClick: () => void) {
                      const disabled = isPending || !acts.includes(action);
                      return (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={onClick}
                          className={[
                            "mr-2 rounded border px-2 py-1 text-xs",
                            disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-50",
                          ].join(" ")}
                        >
                          {isPending ? "Pending..." : label}
                        </button>
                      );
                    }

                    return (
                      <tr key={b.id} className="border-b">
                        <td className="p-2 font-mono">
                          {(() => {
  const code = String((b as any).booking_code || (b as any).id || "");
  const phone = String((b as any).rider_phone || (b as any).passenger_phone || (b as any).passenger_contact || "").trim();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{code}</span>

      <button
        type="button"
        className="rounded border px-2 py-0.5 text-[11px] hover:bg-slate-50"
        title="Copy booking code"
        onClick={() => copyToClipboard(code)}
      >
        Copy
      </button>

      {phone ? (
        <button
          type="button"
          className="rounded border px-2 py-0.5 text-[11px] hover:bg-slate-50"
          title="Copy phone"
          onClick={() => copyToClipboard(phone)}
        >
          Phone
        </button>
      ) : null}
    </span>
  );
})()}
                          {!lguOk ? (
                            <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
                              LGU missing
                            </span>
                          ) : null}
                        </td>

                        <td className="p-2">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                            {s || "-"}
                          </span>
                        </td>

                        <td className="p-2">
                          {ack.state === "idle" ? (
                            <span className="text-slate-400 text-xs">-</span>
                          ) : ack.state === "pending" ? (
                            <span className="text-xs text-amber-700">Pending...</span>
                          ) : ack.state === "ok" ? (
                            <span className="text-xs text-emerald-700">{ack.msg || "ACK"}</span>
                          ) : (
                            <span className="text-xs text-red-700">
                              {ack.msg}
                              {ack.httpStatus ? (
                                <span className="ml-2 text-[10px] text-slate-500">(HTTP {ack.httpStatus})</span>
                              ) : null}
                            </span>
                          )}
                        </td>

                        <td className="p-2">
                          {/* JRIDE_UI_ACK_CHIPS_START */}
<div className="mb-1 flex flex-wrap items-center gap-2">
  {ack.state === "pending" ? (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
      Pending
    </span>
  ) : ack.state === "ok" ? (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
      OK
    </span>
  ) : ack.state === "err" ? (
    <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
      Error
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
      Idle
    </span>
  )}

  {ack.state !== "idle" && (ack as any).msg ? (
    <span className="text-[11px] text-slate-600 truncate max-w-[420px]" title={String((ack as any).msg)}>
      {String((ack as any).msg)}
    </span>
  ) : null}
</div>
{/* JRIDE_UI_ACK_CHIPS_END */}{Btn("Assign", "assigned", () => setStatus(b, "assigned"))}
                          {Btn("On the way", "on_the_way", () => setStatus(b, "on_the_way"))}
                          {Btn("On trip", "on_trip", () => setStatus(b, "on_trip"))}
                          {Btn("Complete", "completed", () => setStatus(b, "completed"))}
                          {Btn("Cancel", "cancelled", () => setStatus(b, "cancelled"))}

                          <button
                            type="button"
                            className="ml-2 rounded border px-2 py-1 text-xs hover:bg-slate-50"
                            title={normStatus(b.status) !== "completed" ? "LGU Fix is allowed for completed trips only." : "Fix missing LGU fields"} disabled={normStatus(b.status) !== "completed"} onClick={() => openFixer(b)}
                          >
                            LGU Fix
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded border">
          <div className="p-3 border-b flex items-center justify-between gap-2">
            <div className="font-semibold">Observability</div>
            <div className="flex items-center gap-2">
              <button
                className="text-xs rounded border px-2 py-1 hover:bg-slate-50"
                onClick={exportActionsCsv}
                type="button"
                title="Download last 10 actions (CSV opens in Excel)"
              >
                Download CSV
              </button>
              <button
                className="text-xs rounded border px-2 py-1 hover:bg-slate-50"
                onClick={() => loadObs().catch(() => {})}
                type="button"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="p-3 text-xs text-slate-600">Last 10 actions (status + assign). No DB.</div>

          <div className="px-3 pb-3 space-y-2">
            {obs.length === 0 ? (
              <div className="text-xs text-slate-400">No actions yet.</div>
            ) : (
              obs.map((a: any) => (
                <div key={a.id} className="rounded border bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[11px]">{String(a.bookingCode || a.bookingId || "-")}</div>
                    <div className="text-[11px] text-slate-500">{a.at ? new Date(a.at).toLocaleTimeString() : ""}</div>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-600">
                    {String(a.type || "status")} ÃƒÆ’Ã‚¢Ãƒ¢Ã¢â€š¬Ã‚ Ãƒ¢Ã¢â€š¬Ã¢â€ž¢ {String(a.nextStatus || a.driverId || "-")} ({a.ok ? "OK" : "BLOCKED"})
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* LGU Fixer Modal */}
      {fixOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded bg-white p-4 shadow">
            <div className="flex items-center justify-between">
              <div className="font-semibold">LGU Fix</div>
              <button className="text-sm rounded border px-2 py-1 hover:bg-slate-50" onClick={() => setFixOpen(false)}>
                Close
              </button>
            </div>

            <div className="mt-2 text-xs text-slate-600">
              Booking: <span className="font-mono">{fixTarget?.booking_code || fixTarget?.id}</span>
            </div>

            <div className="mt-3 space-y-2">
              <div className="text-xs text-slate-600">Admin token (Vercel env: DISPATCH_ADMIN_TOKEN)</div>
              <input className="w-full rounded border px-2 py-2 text-sm" value={fixToken} onChange={(e) => setFixToken(e.target.value)} placeholder="paste token" />

              <div className="grid grid-cols-1 gap-2">
                <div>
                  <div className="text-xs text-slate-600">Origin (from_label)</div>
                  <input className="w-full rounded border px-2 py-2 text-sm" value={fixFrom} onChange={(e) => setFixFrom(e.target.value)} placeholder="e.g., Lagawe Public Market" />
                </div>
                <div>
                  <div className="text-xs text-slate-600">Destination (to_label)</div>
                  <input className="w-full rounded border px-2 py-2 text-sm" value={fixTo} onChange={(e) => setFixTo(e.target.value)} placeholder="e.g., Kiangan Municipal Hall" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-slate-600">Distance (km)</div>
                  <input className="w-full rounded border px-2 py-2 text-sm" value={fixDist} onChange={(e) => setFixDist(e.target.value)} placeholder="e.g., 6.2" />
                </div>
                <div>
                  <div className="text-xs text-slate-600">Verified fare (PHP)</div>
                  <input className="w-full rounded border px-2 py-2 text-sm" value={fixFare} onChange={(e) => setFixFare(e.target.value)} placeholder="e.g., 120" />
                </div>
              </div>

              {fixMsg ? <div className="text-xs text-slate-700">{fixMsg}</div> : null}

              <div className="flex justify-end gap-2 pt-2">
                <button className="rounded border px-3 py-2 text-sm hover:bg-slate-50" onClick={saveFixer}>
                  Save LGU Fields
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}