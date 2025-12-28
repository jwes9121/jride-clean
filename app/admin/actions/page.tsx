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

const ALL = ["requested","assigned","on_the_way","arrived","enroute","on_trip","completed","cancelled"];

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

  async function doInspect() {
    setPending("inspect");
    setLog("");
    try {
      const qs = canUseId
        ? `booking_id=${encodeURIComponent(bookingId.trim())}`
        : `booking_code=${encodeURIComponent(bookingCode.trim())}`;
      const r = await fetch(`/api/dispatch/status?${qs}`, { cache: "no-store" });
      const j = (await r.json()) as Inspect;
      setInspect(j);
      setLog(JSON.stringify(j, null, 2));
    } catch (e: any) {
      setInspect(null);
      setLog(String(e?.message || e));
    } finally {
      setPending("");
    }
  }

  async function doSet() {
    if (!inspect?.booking_id && !inspect?.booking_code) return;
    setPending("set");
    try {
      const body: any = {};
      if (inspect.booking_id) body.booking_id = inspect.booking_id;
      if (inspect.booking_code) body.booking_code = inspect.booking_code;
      body.status = target;
      if (note.trim()) body.note = note.trim();

      const r = await fetch(`/api/dispatch/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as PostResp;
      setLog(JSON.stringify(j, null, 2));
      await doInspect();
    } catch (e: any) {
      setLog(String(e?.message || e));
    } finally {
      setPending("");
    }
  }

  const allowed = (inspect?.allowed_next || []).map((s) => String(s));
  const isAllowed = allowed.includes(target);

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

            <button
              onClick={doInspect}
              disabled={pending.length > 0 || (!canUseId && !canUseCode)}
              className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            >
              {pending === "inspect" ? "Inspecting..." : "Inspect"}
            </button>
          </div>

          <div className="mt-4 text-sm">
            <div className="font-medium">Current</div>
            <div className="mt-1">
              status: <span className="font-mono">{inspect?.current_status ?? "-"}</span>
            </div>
            <div className="mt-1">
              allowed_next: <span className="font-mono">{(inspect?.allowed_next || []).join(", ") || "-"}</span>
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
                    {s}
                  </option>
                ))}
              </select>
              <div className="text-xs mt-1 opacity-70">
                Allowed now: <span className="font-mono">{isAllowed ? "YES" : "NO"}</span>
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
              disabled={pending.length > 0 || !inspect?.booking_id && !inspect?.booking_code}
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