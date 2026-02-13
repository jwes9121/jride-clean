# PATCH-PHASE6L-OPS-GUARDRAILS-FIXPATH4.ps1
# PHASE 6L — Ops Pilot UX Guardrails (FRONTEND ONLY)
# Fix4: PowerShell vars are case-insensitive; use distinct *_PATH and *_CONTENT names.
# Touches ONLY:
#   - app\admin\actions\page.tsx
#   - app\driver\actions\page.tsx

$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

function Backup([string]$relPath){
  if(!(Test-Path -LiteralPath $relPath)){ throw "Missing file: $relPath" }
  $bak = "$relPath.bak.$(Stamp)"
  Copy-Item -LiteralPath $relPath -Destination $bak -Force
  Write-Host "[OK] Backup $bak"
}

function Sanitize-RelPath([string]$p){
  if($null -eq $p){ throw "relPath is null" }

  $q = $p
  $q = $q -replace '[\x00-\x1F]', ''              # ASCII control
  $q = $q -replace "[\u200B-\u200D\uFEFF]", ""    # zero-width + BOM
  $q = [regex]::Replace($q, "\p{Cf}", "")         # unicode format chars
  $q = $q.Trim()
  $q = $q -replace '/', '\'
  return $q
}

function Assert-RelPathSafe([string]$relPath){
  if($relPath -match '<' -or $relPath -match "`r" -or $relPath -match "`n"){
    throw "relPath contains illegal content (looks like TSX/HTML). relPath starts: [$($relPath.Substring(0,[Math]::Min(60,$relPath.Length)))]"
  }
  if($relPath -notmatch 'page\.tsx$'){
    throw "relPath must end with page.tsx. Got: $relPath"
  }
}

function WriteUtf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$relPath,
    [Parameter(Mandatory=$true)][string]$content
  )

  $rp = Sanitize-RelPath $relPath
  Assert-RelPathSafe $rp

  $full = Join-Path -Path (Get-Location) -ChildPath $rp
  $dir  = Split-Path -Parent $full
  if(!(Test-Path -LiteralPath $dir)){ throw "Directory missing: $dir" }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($full, $content, $utf8NoBom)
  Write-Host "[OK] Wrote $rp"
}

# IMPORTANT: distinct variable names (case-insensitive in PowerShell!)
$ADMIN_PATH  = "app\admin\actions\page.tsx"
$DRIVER_PATH = "app\driver\actions\page.tsx"

Backup $ADMIN_PATH
Backup $DRIVER_PATH

# ---------------- ADMIN (6L Guardrails) ----------------
$ADMIN_CONTENT = @'
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
'@

# ---------------- DRIVER (6L Guardrails) ----------------
$DRIVER_CONTENT = @'
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
'@

WriteUtf8NoBom -relPath $ADMIN_PATH  -content $ADMIN_CONTENT
WriteUtf8NoBom -relPath $DRIVER_PATH -content $DRIVER_CONTENT

Write-Host ""
Write-Host "[DONE] PHASE 6L Ops Guardrails applied (FixPath4)."
