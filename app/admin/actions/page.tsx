"use client";

import * as React from "react";

type Inspect = {
  ok?: boolean;
  code?: string;
  message?: string;
  booking_id?: string | null;
  booking_code?: string | null;
  current_status?: string | null;
  has_driver?: boolean;
  allowed_next?: string[];
  booking?: any;
};

type PostResp = {
  ok?: boolean;
  code?: string;
  message?: string;
  changed?: boolean;
  booking_id?: string;
  booking_code?: string | null;
  status?: string | null;
  allowed_next?: string[];
  update_error?: string | null;
  booking?: any;
};

const ALL = ["requested", "assigned", "on_the_way", "arrived", "enroute", "on_trip", "completed", "cancelled"];

function normList(v: any): string[] {
  return (Array.isArray(v) ? v : []).map((x) => String(x));
}

function safeJsonParse(txt: string): any | null {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function extractFromLog(log: string): { booking_id?: string; booking_code?: string } {
  const j = safeJsonParse(log);
  if (!j || typeof j !== "object") return {};

  const bid =
    (j.booking_id ?? j.bookingId ?? j.id ?? j.uuid ?? j?.booking?.id ?? j?.booking?.uuid) as any;
  const bcode =
    (j.booking_code ?? j.bookingCode ?? j?.booking?.booking_code ?? j?.booking?.code) as any;

  const out: any = {};
  if (bid != null && String(bid).trim()) out.booking_id = String(bid).trim();
  if (bcode != null && String(bcode).trim()) out.booking_code = String(bcode).trim();
  return out;
}

async function copyText(txt: string): Promise<boolean> {
  const t = String(txt || "");
  if (!t) return false;

  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function AdminActionsPage() {
  const [bookingId, setBookingId] = React.useState("");
  const [bookingCode, setBookingCode] = React.useState("");
  const [target, setTarget] = React.useState("assigned");
  const [note, setNote] = React.useState("");
  const [inspect, setInspect] = React.useState<Inspect | null>(null);
  const [log, setLog] = React.useState<string>("");
  const [pending, setPending] = React.useState<string>("");

  const canUseId = bookingId.trim().length > 0;
  const canUseCode = bookingCode.trim().length > 0;

  // Prevent acting on stale inspect data if user edits lookup inputs
  React.useEffect(() => {
    setInspect(null);
    setPending("");
    // keep log visible; but clear "Allowed now" confusion by resetting to default
    setTarget("assigned");
  }, [bookingId, bookingCode]);

  async function doInspect(opts?: { silent?: boolean }) {
    setPending("inspect");
    if (!opts?.silent) setLog("");

    try {
      const qs = canUseId
        ? `booking_id=${encodeURIComponent(bookingId.trim())}`
        : `booking_code=${encodeURIComponent(bookingCode.trim())}`;

      const r = await fetch(`/api/dispatch/status?${qs}`, { cache: "no-store" });
      const j = (await r.json()) as Inspect;

      setInspect(j);

      // Reset dropdown target based on the *new* server truth
      const allowedNext = normList(j.allowed_next);
      const cs = j.current_status ? String(j.current_status) : "";
      let nextTarget = "assigned";

      if (allowedNext.length > 0) nextTarget = allowedNext[0];
      else if (cs && ALL.includes(cs)) nextTarget = cs;

      setTarget(nextTarget);

      if (!opts?.silent) setLog(JSON.stringify(j, null, 2));
    } catch (e: any) {
      setInspect(null);
      setLog(String(e?.message || e));
    } finally {
      setPending("");
    }
  }

  async function postStatus(nextStatus: string) {
    if (!inspect?.booking_id && !inspect?.booking_code) return;

    setPending("set");
    try {
      const body: any = {};
      if (inspect.booking_id) body.booking_id = inspect.booking_id;
      if (inspect.booking_code) body.booking_code = inspect.booking_code;
      body.status = nextStatus;
      if (note.trim()) body.note = note.trim();

      const r = await fetch(`/api/dispatch/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = (await r.json()) as PostResp;

      // Keep the POST response visible
      setLog(JSON.stringify(j, null, 2));

      // Refresh inspect silently to keep UI in sync without overwriting the POST log
      await doInspect({ silent: true });
    } catch (e: any) {
      setLog(String(e?.message || e));
    } finally {
      setPending("");
    }
  }

  async function doSet() {
    await postStatus(String(target));
  }

  // --- Phase 6K harness helpers ---
  function fillFromLog() {
    const ex = extractFromLog(log);
    if (ex.booking_id) setBookingId(ex.booking_id);
    if (ex.booking_code) setBookingCode(ex.booking_code);
  }

  async function copyBookingId() {
    const id = (inspect?.booking_id ?? "").toString();
    const ok = await copyText(id);
    if (!ok) setLog((prev) => (prev ? prev + "\n\n" : "") + "[COPY FAILED] booking_id");
  }

  async function copyBookingCode() {
    const code = (inspect?.booking_code ?? "").toString();
    const ok = await copyText(code);
    if (!ok) setLog((prev) => (prev ? prev + "\n\n" : "") + "[COPY FAILED] booking_code");
  }

  async function advanceNextAllowed() {
    const allowed = normList(inspect?.allowed_next);
    if (allowed.length < 1) return;
    await postStatus(allowed[0]);
  }

  const allowed = normList(inspect?.allowed_next);
  const isAllowed = allowed.includes(String(target));
  const nextAllowed = allowed[0] || "";

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin Actions</h1>
          <p className="text-sm opacity-70">
            Inspect any booking and attempt a status change. Server rules still apply.
          </p>
        </div>
        <a className="px-3 py-2 rounded border text-sm" href="/admin">Back</a>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded border p-4">
          <h2 className="font-medium">Lookup</h2>

          <div className="mt-3 space-y-3">
            <div>
              <label className="text-sm block mb-1">Booking id (uuid)</label>
              <input
                value={bookingId}
                onChange={(e) => setBookingId(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="uuid only (NO <> )"
              />
            </div>

            <div>
              <label className="text-sm block mb-1">OR Booking code</label>
              <input
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="JR-UI-..."
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => doInspect()}
                disabled={pending.length > 0 || (!canUseId && !canUseCode)}
                className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
              >
                {pending === "inspect" ? "Inspecting..." : "Inspect"}
              </button>

              {/* Phase 6K harness */}
              <button
                onClick={fillFromLog}
                disabled={pending.length > 0 || !log.trim()}
                className="px-3 py-2 rounded border text-sm disabled:opacity-50"
                title="Parse Response Log JSON and fill booking_id/booking_code if found"
              >
                Fill from log
              </button>

              <button
                onClick={copyBookingId}
                disabled={pending.length > 0 || !inspect?.booking_id}
                className="px-3 py-2 rounded border text-sm disabled:opacity-50"
                title="Copy inspect.booking_id"
              >
                Copy id
              </button>

              <button
                onClick={copyBookingCode}
                disabled={pending.length > 0 || !inspect?.booking_code}
                className="px-3 py-2 rounded border text-sm disabled:opacity-50"
                title="Copy inspect.booking_code"
              >
                Copy code
              </button>
            </div>
          </div>

          <div className="mt-4 text-sm">
            <div className="font-medium">Current</div>
            <div className="mt-1">
              status: <span className="font-mono">{inspect?.current_status ?? "-"}</span>
            </div>
            <div className="mt-1">
              allowed_next:{" "}
              <span className="font-mono">{(inspect?.allowed_next || []).join(", ") || "-"}</span>
            </div>
            <div className="mt-1">
              has_driver: <span className="font-mono">{String(!!inspect?.has_driver)}</span>
            </div>
          </div>
        </div>

        <div className="rounded border p-4">
          <h2 className="font-medium">Set Status</h2>
          <p className="text-sm opacity-70 mt-1">
            This will POST to /api/dispatch/status. If not allowed, you will see 409 details in the log.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm block mb-1">Target status</label>
              <select
                className="w-full border rounded px-3 py-2"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {ALL.map((s) => (
                  <option key={s} value={s}>
                    {s}{allowed.includes(s) ? " (allowed)" : ""}
                  </option>
                ))}
              </select>
              <div className="text-xs mt-1 opacity-70">
                Allowed now: <span className="font-mono">{isAllowed ? "YES" : "NO"}</span>
              </div>

              {/* Phase 6K harness */}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={advanceNextAllowed}
                  disabled={pending.length > 0 || !inspect?.booking_id && !inspect?.booking_code || !nextAllowed}
                  className="px-3 py-2 rounded border text-sm disabled:opacity-50"
                  title="POST the first allowed_next and refresh inspect"
                >
                  Next allowed{nextAllowed ? `: ${nextAllowed}` : ""}
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm block mb-1">Note (optional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="status note (optional)"
              />
            </div>

            <button
              onClick={doSet}
              disabled={pending.length > 0 || (!inspect?.booking_id && !inspect?.booking_code)}
              className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            >
              {pending === "set" ? "Working..." : "Set status"}
            </button>

            <div className="text-xs opacity-70">
              Tip: If booking has no driver_id, the API blocks statuses beyond requested (except cancelled).
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded border p-4">
        <div className="font-medium">Response Log</div>
        <pre className="mt-2 text-xs whitespace-pre-wrap bg-gray-50 p-3 rounded border overflow-auto">
{log || "No output yet."}
        </pre>
      </div>
    </div>
  );
}