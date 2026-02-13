"use client";

import * as React from "react";

type Inspect = {
  booking_id?: string | null;
  booking_code?: string | null;
  current_status?: string | null;
  has_driver?: boolean;
  allowed_next?: string[];
};

type PostResp = {
  ok?: boolean;
  code?: string;
  message?: string;
  status?: string | null;
  allowed_next?: string[];
};

const ALL = ["requested", "assigned", "on_the_way", "arrived", "enroute", "on_trip", "completed", "cancelled"];
const norm = (v: any) => (Array.isArray(v) ? v.map((x) => String(x)) : []);

export default function AdminActionsPage() {
  const [bookingId, setBookingId] = React.useState("");
  const [bookingCode, setBookingCode] = React.useState("");
  const [inspect, setInspect] = React.useState<Inspect | null>(null);

  // Split logs for ops clarity
  const [logInspect, setLogInspect] = React.useState("");
  const [logPost, setLogPost] = React.useState("");

  const [target, setTarget] = React.useState("assigned");
  const [pending, setPending] = React.useState("");

  const canUseId = bookingId.trim().length > 0;
  const canUseCode = bookingCode.trim().length > 0;

  React.useEffect(() => {
    setInspect(null);
    setPending("");
    setTarget("assigned");
  }, [bookingId, bookingCode]);

  async function inspectNow(opts?: { silent?: boolean }) {
    setPending("inspect");
    if (!opts?.silent) setLogInspect("");

    try {
      const qs = canUseId
        ? `booking_id=${encodeURIComponent(bookingId.trim())}`
        : `booking_code=${encodeURIComponent(bookingCode.trim())}`;

      const r = await fetch(`/api/dispatch/status?${qs}`, { cache: "no-store" });
      const j = (await r.json()) as Inspect;

      setInspect(j);

      const allowed = norm(j.allowed_next);
      const next = allowed[0] ?? (j.current_status ? String(j.current_status) : "assigned");
      setTarget(next);

      if (!opts?.silent) setLogInspect(JSON.stringify(j, null, 2));
    } catch (e: any) {
      setInspect(null);
      if (!opts?.silent) setLogInspect(String(e?.message || e));
    } finally {
      setPending("");
    }
  }

  async function post(next: string) {
    if (!inspect?.booking_id && !inspect?.booking_code) return;

    setPending("post");
    try {
      const body: any = { status: next };
      if (inspect.booking_id) body.booking_id = inspect.booking_id;
      if (inspect.booking_code) body.booking_code = inspect.booking_code;

      const r = await fetch("/api/dispatch/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = (await r.json()) as PostResp;
      setLogPost(JSON.stringify(j, null, 2));

      await inspectNow({ silent: true });
    } catch (e: any) {
      setLogPost(String(e?.message || e));
    } finally {
      setPending("");
    }
  }

  const allowed = norm(inspect?.allowed_next);
  const ready = !!inspect?.has_driver && allowed.length > 0;
  const isAllowed = allowed.includes(String(target));

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin Actions</h1>
          <p className="text-sm opacity-70">Ops guardrails: readiness + separated logs.</p>
        </div>
        <a className="px-3 py-2 rounded border text-sm" href="/admin">Back</a>
      </div>

      <div className={"p-3 rounded border " + (ready ? "bg-green-50" : "bg-red-50")}>
        <div className="font-semibold">{ready ? "READY" : "NOT READY"}</div>
        <div className="text-sm opacity-70">
          {ready
            ? "Driver assigned and lifecycle can proceed."
            : "No driver assigned or blocked state. Most lifecycle steps will fail until a driver is assigned."}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded p-4 space-y-2">
          <h2 className="font-medium">Lookup</h2>

          <input
            className="w-full border rounded px-3 py-2"
            placeholder="booking id (uuid)"
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="booking code"
            value={bookingCode}
            onChange={(e) => setBookingCode(e.target.value)}
          />

          <button
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            disabled={pending.length > 0 || (!canUseId && !canUseCode)}
            onClick={() => inspectNow()}
          >
            {pending === "inspect" ? "Inspecting..." : "Inspect"}
          </button>

          <div className="text-sm pt-2">
            <div>current_status: <span className="font-mono">{inspect?.current_status ?? "-"}</span></div>
            <div>allowed_next: <span className="font-mono">{allowed.join(", ") || "-"}</span></div>
            <div>has_driver: <span className="font-mono">{String(!!inspect?.has_driver)}</span></div>
          </div>
        </div>

        <div className="border rounded p-4 space-y-2">
          <h2 className="font-medium">Set Status</h2>

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

          <div className="text-xs opacity-70">
            Allowed now: <span className="font-mono">{isAllowed ? "YES" : "NO"}</span>
          </div>

          <button
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={pending.length > 0 || !ready || !isAllowed}
            onClick={() => post(String(target))}
          >
            {pending === "post" ? "Working..." : "Apply"}
          </button>

          {!ready && (
            <div className="text-xs text-red-700">
              Guardrail: not ready (driver missing or blocked). Assign driver first.
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded p-3">
          <div className="font-medium">INSPECT LOG</div>
          <pre className="mt-2 text-xs whitespace-pre-wrap bg-gray-50 p-3 rounded border overflow-auto">{logInspect || "-"}</pre>
        </div>
        <div className="border rounded p-3">
          <div className="font-medium">POST LOG</div>
          <pre className="mt-2 text-xs whitespace-pre-wrap bg-gray-50 p-3 rounded border overflow-auto">{logPost || "-"}</pre>
        </div>
      </div>
    </div>
  );
}