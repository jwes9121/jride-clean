# PATCH-JRIDE_PHASE6A_RIDE_BOOKING_NIGHTGATE.ps1
# Phase 6A: Ride booking form + API night gate (8PM-5AM Asia/Manila)
# ASCII ONLY. No Unicode. Do not touch LiveTrips.

$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function EnsureDir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }
function BackupFile($p) {
  if (Test-Path $p) {
    $bak = "$p.bak.$(Timestamp)"
    Copy-Item $p $bak -Force
    Write-Host "[OK] Backup: $bak"
  }
}
function WriteUtf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

# ---- Paths (repo-root relative) ----
$ridePage     = "app\ride\page.tsx"
$canBookRoute = "app\api\public\passenger\can-book\route.ts"
$bookRoute    = "app\api\public\passenger\book\route.ts"

# ---- Ensure folders ----
EnsureDir (Split-Path $ridePage)
EnsureDir (Split-Path $canBookRoute)
EnsureDir (Split-Path $bookRoute)

# ---- Backup ----
BackupFile $ridePage
BackupFile $canBookRoute
BackupFile $bookRoute

# -------------------------
# app/api/public/passenger/can-book/route.ts
# -------------------------
$canBookTs = @'
import { NextResponse } from "next/server";

type CanBookReq = {
  town?: string | null;
  service?: string | null;
  verified?: boolean | null;
};

function manilaNowParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return { hour, minute };
}

function isNightGateNow() {
  const { hour } = manilaNowParts();
  // Night gate window: 20:00 - 05:00 (Asia/Manila)
  return hour >= 20 || hour < 5;
}

export async function GET() {
  const nightGate = isNightGateNow();
  return NextResponse.json(
    {
      ok: true,
      nightGate,
      window: "20:00-05:00 Asia/Manila",
      note: "POST with { verified:true } bypasses night gate temporarily (will be wired to passengers verification tier).",
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CanBookReq;

  const nightGate = isNightGateNow();
  const verified = !!body.verified;

  if (nightGate && !verified) {
    return NextResponse.json(
      {
        ok: false,
        code: "NIGHT_GATE_UNVERIFIED",
        message: "Booking is restricted from 8PM to 5AM unless verified.",
        nightGate: true,
        window: "20:00-05:00 Asia/Manila",
      },
      { status: 403 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      nightGate,
      allowed: true,
      town: body.town ?? null,
      service: body.service ?? null,
      verified,
    },
    { status: 200 }
  );
}
'@

# -------------------------
# app/api/public/passenger/book/route.ts
# -------------------------
$bookTs = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type BookReq = {
  passenger_name?: string | null;
  town?: string | null;

  from_label?: string | null;
  to_label?: string | null;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;

  service?: string | null;
};

function codeNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}${m}${day}${hh}${mm}${ss}`;
}

function rand4() {
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as BookReq;

  const booking_code = `JR-UI-${codeNow()}-${rand4()}`;

  const payload: any = {
    booking_code,
    passenger_name: body.passenger_name ?? null,
    from_label: body.from_label ?? null,
    to_label: body.to_label ?? null,
    town: body.town ?? null,
    pickup_lat: body.pickup_lat ?? null,
    pickup_lng: body.pickup_lng ?? null,
    dropoff_lat: body.dropoff_lat ?? null,
    dropoff_lng: body.dropoff_lng ?? null,
  };

  const { data, error } = await supabase
    .from("bookings")
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[passenger/book] insert error", error);
    return NextResponse.json(
      { ok: false, code: "BOOKING_INSERT_FAILED", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, booking_code, booking: data ?? null },
    { status: 200 }
  );
}
'@

# -------------------------
# app/ride/page.tsx
# -------------------------
$rideTs = @'
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type CanBookResp = {
  ok?: boolean;
  code?: string;
  message?: string;
  nightGate?: boolean;
  window?: string;
};

type BookResp = {
  ok?: boolean;
  booking_code?: string;
  code?: string;
  message?: string;
  booking?: any;
};

function numOrNull(s: string): number | null {
  const t = String(s || "").trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

export default function RidePage() {
  const router = useRouter();

  const [town, setTown] = React.useState("Lagawe");
  const [passengerName, setPassengerName] = React.useState("Test Passenger A");
  const [verified, setVerified] = React.useState(false);

  const [fromLabel, setFromLabel] = React.useState("Lagawe Public Market");
  const [toLabel, setToLabel] = React.useState("Lagawe Town Plaza");

  const [pickupLat, setPickupLat] = React.useState("16.7999");
  const [pickupLng, setPickupLng] = React.useState("121.1175");
  const [dropLat, setDropLat] = React.useState("16.8016");
  const [dropLng, setDropLng] = React.useState("121.1222");

  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string>("");

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    return { ok: r.ok, status: r.status, json: j };
  }

  async function submit() {
    setResult("");
    setBusy(true);
    try {
      const can = await postJson("/api/public/passenger/can-book", {
        town,
        service: "ride",
        verified,
      });

      if (!can.ok) {
        const cj = can.json as CanBookResp;
        setResult("CAN_BOOK_BLOCKED: " + (cj.code || "BLOCKED") + " - " + (cj.message || "Not allowed"));
        return;
      }

      const book = await postJson("/api/public/passenger/book", {
        passenger_name: passengerName,
        town,
        from_label: fromLabel,
        to_label: toLabel,
        pickup_lat: numOrNull(pickupLat),
        pickup_lng: numOrNull(pickupLng),
        dropoff_lat: numOrNull(dropLat),
        dropoff_lng: numOrNull(dropLng),
        service: "ride",
      });

      if (!book.ok) {
        const bj = book.json as BookResp;
        setResult("BOOK_FAILED: " + (bj.code || "FAILED") + " - " + (bj.message || "Insert failed"));
        return;
      }

      const bj = book.json as BookResp;
      setResult("BOOKED_OK: " + (bj.booking_code || "(no code returned)"));
    } catch (e: any) {
      setResult("ERROR: " + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Book a Ride</h1>
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Back
          </button>
        </div>

        <p className="mt-2 text-sm opacity-70">
          Phase 6A: booking form + night gate (20:00-05:00 Asia/Manila) at API level.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-black/10 p-4">
            <div className="font-semibold mb-3">Passenger</div>

            <label className="block text-xs font-semibold opacity-70 mb-1">Passenger name</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={passengerName}
              onChange={(e) => setPassengerName(e.target.value)}
            />

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Town</label>
            <select
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={town}
              onChange={(e) => setTown(e.target.value)}
            >
              <option value="Lagawe">Lagawe</option>
              <option value="Kiangan">Kiangan</option>
              <option value="Lamut">Lamut</option>
              <option value="Hingyon">Hingyon</option>
              <option value="Banaue">Banaue</option>
            </select>

            <label className="mt-3 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
              Verified (temporary toggle)
            </label>
          </div>

          <div className="rounded-2xl border border-black/10 p-4">
            <div className="font-semibold mb-3">Route</div>

            <label className="block text-xs font-semibold opacity-70 mb-1">Pickup label</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={fromLabel}
              onChange={(e) => setFromLabel(e.target.value)}
            />

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Pickup lat</label>
                <input className="w-full rounded-xl border border-black/10 px-3 py-2" value={pickupLat} onChange={(e) => setPickupLat(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Pickup lng</label>
                <input className="w-full rounded-xl border border-black/10 px-3 py-2" value={pickupLng} onChange={(e) => setPickupLng(e.target.value)} />
              </div>
            </div>

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Dropoff label</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={toLabel}
              onChange={(e) => setToLabel(e.target.value)}
            />

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Dropoff lat</label>
                <input className="w-full rounded-xl border border-black/10 px-3 py-2" value={dropLat} onChange={(e) => setDropLat(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Dropoff lng</label>
                <input className="w-full rounded-xl border border-black/10 px-3 py-2" value={dropLng} onChange={(e) => setDropLng(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-3 items-center">
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className={"rounded-xl px-5 py-2 font-semibold text-white " + (busy ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500")}
          >
            {busy ? "Booking..." : "Submit booking"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => setResult("")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
          >
            Clear
          </button>
        </div>

        {result ? (
          <div className="mt-4 rounded-xl border border-black/10 bg-white p-3 text-sm">
            <div className="font-semibold">Result</div>
            <div className="mt-1 font-mono text-xs whitespace-pre-wrap">{result}</div>
          </div>
        ) : null}

        <div className="mt-6 text-xs opacity-70">
          Next: verification tier wiring from passengers, then wallet precheck, then dispatch assign hook.
        </div>
      </div>
    </main>
  );
}
'@

# ---- Write files ----
WriteUtf8NoBom $canBookRoute $canBookTs
WriteUtf8NoBom $bookRoute $bookTs
WriteUtf8NoBom $ridePage $rideTs

Write-Host "[OK] Wrote: $canBookRoute"
Write-Host "[OK] Wrote: $bookRoute"
Write-Host "[OK] Wrote: $ridePage"
Write-Host "[NEXT] Run: npm run build"
