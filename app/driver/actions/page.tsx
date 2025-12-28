"use client";

import * as React from "react";

type Inspect = {
  booking_id?: string | null;
  booking_code?: string | null;
  current_status?: string | null;
  allowed_next?: string[];
};

type PostResp = {
  ok?: boolean;
  code?: string;
  message?: string;
  status?: string | null;
  allowed_next?: string[];
};

const norm = (v: any) => (Array.isArray(v) ? v.map((x) => String(x)) : []);

export default function DriverActionsPage() {
  const [bookingId, setBookingId] = React.useState("");
  const [bookingCode, setBookingCode] = React.useState("");
  const [inspect, setInspect] = React.useState<Inspect | null>(null);
  const [log, setLog] = React.useState("");
  const [pending, setPending] = React.useState("");

  const canUseId = bookingId.trim().length > 0;
  const canUseCode = bookingCode.trim().length > 0;

  React.useEffect(() => {
    setInspect(null);
    setPending("");
  }, [bookingId, bookingCode]);

  async function inspectNow() {
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

  async function post(next: string) {
    if (!inspect?.booking_id && !inspect?.booking_code) return;

    setPending(next);
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
      setLog(JSON.stringify(j, null, 2));
      await inspectNow();
    } catch (e: any) {
      setLog(String(e?.message || e));
    } finally {
      setPending("");
    }
  }

  const allowed = norm(inspect?.allowed_next);
  const current = inspect?.current_status ? String(inspect.current_status) : "-";
  const nextAllowed = allowed[0] || "";

  const pill = (s: string, active: boolean) =>
    "px-3 py-2 rounded border text-sm " + (active ? "bg-black text-white" : "bg-white text-black");

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Driver Actions</h1>
          <p className="text-sm opacity-70">Ops guardrails: current step highlight + next allowed primary.</p>
        </div>
        <a className="px-3 py-2 rounded border text-sm" href="/ride">Back</a>
      </div>

      <div className="p-3 rounded border">
        <div className="font-medium">Current step</div>
        <div className="font-mono">{current}</div>
      </div>

      <div className="border rounded p-4 space-y-2">
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
          onClick={inspectNow}
        >
          {pending === "inspect" ? "Inspecting..." : "Inspect"}
        </button>
      </div>

      <div className="border rounded p-4 space-y-3">
        <button
          className="px-4 py-2 rounded border text-sm disabled:opacity-50"
          disabled={pending.length > 0 || !nextAllowed}
          onClick={() => post(nextAllowed)}
          title="Advance to the first allowed_next"
        >
          Next allowed{nextAllowed ? `: ${nextAllowed}` : ""}
        </button>

        <div className="flex flex-wrap gap-2">
          {allowed.map((s) => (
            <button
              key={s}
              className={pill(s, s === current)}
              disabled={pending.length > 0}
              onClick={() => post(s)}
            >
              {pending === s ? "Working..." : s}
            </button>
          ))}
        </div>

        <div className="text-xs opacity-70">
          allowed_next: <span className="font-mono">{allowed.join(", ") || "-"}</span>
        </div>
      </div>

      <div className="border rounded p-4">
        <div className="font-medium">Response Log</div>
        <pre className="mt-2 text-xs whitespace-pre-wrap bg-gray-50 p-3 rounded border overflow-auto">{log || "-"}</pre>
      </div>
    </div>
  );
}