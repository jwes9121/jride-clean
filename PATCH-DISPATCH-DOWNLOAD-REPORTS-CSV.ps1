# PATCH-DISPATCH-DOWNLOAD-REPORTS-CSV.ps1
# Full file replace: app/dispatch/page.tsx
# Adds Excel-friendly CSV downloads:
# - Observability actions (last 10)
# - Current bookings table snapshot

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }
function WriteUtf8NoBom([string]$path, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllBytes($path, $enc.GetBytes($text))
}

$ts = Stamp
$target = "app\dispatch\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

Copy-Item $target "$target.bak.$ts" -Force
Write-Host "[OK] Backup: $target.bak.$ts" -ForegroundColor Green

$content = @'
"use client";

import React, { useEffect, useMemo, useState } from "react";

type Booking = {
  id: string;
  booking_code?: string | null;
  status?: string | null;
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

async function postJson(url: string, body: any, dispatcherName?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (dispatcherName && dispatcherName.trim()) {
    headers["x-dispatcher-name"] = dispatcherName.trim();
  }

  const r = await fetch(url, {
    method: "POST",
    headers,
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

function badgeBase(ok: boolean, code?: string) {
  if (!ok) return "text-red-700 border-red-200 bg-red-50";
  if (code === "FORCE_OK") return "text-amber-800 border-amber-200 bg-amber-50";
  return "text-emerald-700 border-emerald-200 bg-emerald-50";
}

function badgeLabel(ok: boolean, code?: string) {
  if (!ok) return "BLOCKED";
  if (code === "FORCE_OK") return "FORCE";
  return "OK";
}

function clipCopy(text: string) {
  if (typeof navigator === "undefined") return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {}
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

export default function DispatchPage() {
  const [rows, setRows] = useState<Booking[]>([]);
  const [ackMap, setAckMap] = useState<Record<string, AckState>>({});
  const [obs, setObs] = useState<any[]>([]);
  const [lastLoadAt, setLastLoadAt] = useState<number>(0);

  const [dispatcherName, setDispatcherName] = useState<string>("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("JRIDE_DISPATCHER_NAME");
      if (saved) setDispatcherName(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("JRIDE_DISPATCHER_NAME", dispatcherName);
    } catch {}
  }, [dispatcherName]);

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
      const j = await postJson(
        "/api/dispatch/status",
        { bookingId: String(b.id), status: nextStatus },
        dispatcherName
      );

      setAck(key, {
        state: "ok",
        at: Date.now(),
        actionId: j?.actionId,
        msg: "ACK: " + nextStatus,
      });

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

  const rowsSorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return copy;
  }, [rows]);

  function exportActionsCsv() {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
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
    const csv = toCsv(normalized, cols);
    downloadText(filename, csv);
  }

  function exportBookingsCsv() {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `dispatch-bookings-${stamp}.csv`;

    const normalized = rowsSorted.map((b) => ({
      booking_code: b.booking_code || "",
      id: b.id || "",
      status: normStatus(b.status) || "",
    }));

    const cols = ["booking_code","id","status"];
    const csv = toCsv(normalized, cols);
    downloadText(filename, csv);
  }

  return (
    <div className="p-4 space-y-4">
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
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded border">
          <div className="p-3 border-b font-semibold flex items-center justify-between">
            <span>Bookings</span>
            <button
              type="button"
              className="text-xs rounded border px-2 py-1 hover:bg-slate-50"
              onClick={exportBookingsCsv}
              title="Download the current Dispatch table (CSV opens in Excel)"
            >
              Download CSV
            </button>
          </div>

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
                  rowsSorted.map((b) => {
                    const key = keyOf(b);
                    const s = normStatus(b.status);
                    const acts = allowedActions(s);
                    const ack = ackMap[key] || { state: "idle" };

                    const isPending = ack.state === "pending";

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
                          title={disabled ? "Not allowed for this status (or pending)" : "Set status: " + action}
                        >
                          {isPending ? "Pending..." : label}
                        </button>
                      );
                    }

                    return (
                      <tr key={b.id} className="border-b">
                        <td className="p-2 font-mono">{b.booking_code ? b.booking_code : b.id}</td>

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
                            <span className="text-xs text-emerald-700">
                              {ack.msg || "ACK"}
                              {ack.actionId ? (
                                <span className="ml-2 text-[10px] text-slate-500">(id: {String(ack.actionId).slice(0, 8)})</span>
                              ) : null}
                            </span>
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
                          {Btn("Assign", "assigned", () => setStatus(b, "assigned"))}
                          {Btn("On the way", "on_the_way", () => setStatus(b, "on_the_way"))}
                          {Btn("On trip", "on_trip", () => setStatus(b, "on_trip"))}
                          {Btn("Complete", "completed", () => setStatus(b, "completed"))}
                          {Btn("Cancel", "cancelled", () => setStatus(b, "cancelled"))}
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
                title="Download the last 10 actions (CSV opens in Excel)"
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
              obs.map((a: any) => {
                const ok = Boolean(a.ok);
                const code = String(a.code || "");
                const time = a.at ? new Date(a.at).toLocaleTimeString() : "";
                const who = String(a.actor || "unknown");
                const idLabel = String(a.bookingCode || a.bookingId || "-");
                const type = String(a.type || "status").toUpperCase();
                const detail = type === "ASSIGN" ? String(a.driverId || "-") : String(a.nextStatus || "-");

                return (
                  <div key={a.id} className="rounded border bg-white p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-mono text-[11px]">{idLabel}</div>
                      <div className="text-[11px] text-slate-500">{time}</div>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full border px-2 py-0.5">{type}</span>
                      <span className="rounded-full border px-2 py-0.5">{detail}</span>

                      <span className={["rounded-full border px-2 py-0.5", badgeBase(ok, code)].join(" ")}>
                        {ok ? (code === "FORCE_OK" ? "FORCE" : "OK") : "BLOCKED"}
                      </span>

                      <span className="text-slate-500">by {who}</span>

                      <button
                        type="button"
                        className="ml-auto text-[11px] rounded border px-2 py-0.5 hover:bg-slate-50"
                        onClick={() => clipCopy(JSON.stringify(a, null, 2))}
                        title="Copy this action as JSON"
                      >
                        Copy JSON
                      </button>
                    </div>

                    {!ok && a.message ? <div className="mt-1 text-[11px] text-red-700">{String(a.message)}</div> : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
'@

WriteUtf8NoBom $target $content
Write-Host "[DONE] Patched: $target" -ForegroundColor Green
Write-Host "Next: npm.cmd run build ; npm.cmd run dev" -ForegroundColor Yellow
