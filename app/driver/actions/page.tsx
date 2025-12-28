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

export default function DriverActionsPage() {
  const [bookingId, setBookingId] = React.useState("");
  const [bookingCode, setBookingCode] = React.useState("");
  const [inspect, setInspect] = React.useState<Inspect | null>(null);
  const [log, setLog] = React.useState<string>("");
  const [pending, setPending] = React.useState<string>("");

  const canUseId = bookingId.trim().length > 0;
  const canUseCode = bookingCode.trim().length > 0;

  // Prevent acting on stale inspect data if user edits lookup inputs
  React.useEffect(() => {
    setInspect(null);
    setPending("");
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

      if (!opts?.silent) setLog(JSON.stringify(j, null, 2));
    } catch (e: any) {
      setInspect(null);
      setLog(String(e?.message || e));
    } finally {
      setPending("");
    }
  }

  async function setStatus(nextStatus: string) {
    if (!inspect?.booking_id && !inspect?.booking_code) return;

    setPending(nextStatus);
    try {
      const body: any = {};
      if (inspect.booking_id) body.booking_id = inspect.booking_id;
      if (inspect.booking_code) body.booking_code = inspect.booking_code;
      body.status = nextStatus;

      const r = await fetch(`/api/dispatch/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = (await r.json()) as PostResp;

      // Keep POST response visible
      setLog(JSON.stringify(j, null, 2));

      // Refresh inspector silently so UI stays in sync without overwriting the POST log
      await doInspect({ silent: true });
    } catch (e: any) {
      setLog(String(e?.message || e));
    } finally {
      setPending("");
    }
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
    await setStatus(allowed[0]);
  }

  const allowed = normList(inspect?.allowed_next);
  const nextAllowed = allowed[0] || "";

  const btn = (label: string, st: string) => {
    const enabled = allowed.includes(st);

    return (
      <button
        onClick={() => enabled && setStatus(st)}
        className={
          "px-3 py-2 rounded border text-sm " +
          (enabled ? "bg-black text-white" : "bg-white text-black")
        }
        disabled={!enabled || pending.length > 0}
        title={enabled ? "Allowed" : "Not allowed from current status"}
      >
        {pending === st ? "Working..." : label}
      </button>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Driver Actions</h1>
          <p className="text-sm opacity-70">
            Use this to move a trip through the lifecycle using the server rules (GET inspector + POST transitions).
          </p>
        </div>
        <a className="px-3 py-2 rounded border text-sm" href="/ride">Back</a>
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
                placeholder="e.g. bb77ba36-145d-497e-9d65-41a129e1a676 (NO <> )"
              />
            </div>

            <div>
              <label className="text-sm block mb-1">OR Booking code</label>
              <input
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="e.g. JR-UI-YYYYMMDDHHMMSS-1234"
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
          </div>
        </div>

        <div className="rounded border p-4">
          <h2 className="font-medium">Lifecycle Buttons</h2>
          <p className="text-sm opacity-70 mt-1">
            Buttons enable only if the server says the transition is allowed.
          </p>

          {/* Phase 6K harness */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={advanceNextAllowed}
              disabled={pending.length > 0 || !inspect?.booking_id && !inspect?.booking_code || !nextAllowed}
              className="px-3 py-2 rounded border text-sm disabled:opacity-50"
              title="POST the first allowed_next and refresh inspect"
            >
              Next allowed{nextAllowed ? `: ${nextAllowed}` : ""}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {btn("Assigned", "assigned")}
            {btn("On the way", "on_the_way")}
            {btn("Arrived", "arrived")}
            {btn("Enroute", "enroute")}
            {btn("On trip", "on_trip")}
            {btn("Completed", "completed")}
            {btn("Cancelled", "cancelled")}
          </div>

          <div className="mt-4 text-xs opacity-70">
            Note: If you created the booking without auto-assign (no driver_id), only "cancelled" may be allowed.
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