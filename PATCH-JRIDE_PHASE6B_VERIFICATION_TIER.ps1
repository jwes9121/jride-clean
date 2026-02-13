# PATCH-JRIDE_PHASE6B_VERIFICATION_TIER.ps1
# Phase 6B: Verification tier enforcement (server-side), remove UI toggle
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

$canBookRoute = "app\api\public\passenger\can-book\route.ts"
$ridePage     = "app\ride\page.tsx"

EnsureDir (Split-Path $canBookRoute)
EnsureDir (Split-Path $ridePage)

BackupFile $canBookRoute
BackupFile $ridePage

# -------------------------
# app/api/public/passenger/can-book/route.ts
# -------------------------
$canBookTs = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type CanBookReq = {
  town?: string | null;
  service?: string | null;
  // legacy: verified?: boolean | null; (ignored in Phase 6B)
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

function truthy(v: any) {
  if (v === true) return true;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "yes" || t === "verified" || t === "tier1" || t === "tier2") return true;
  }
  if (typeof v === "number") return v > 0;
  return false;
}

async function resolvePassengerVerification(supabase: ReturnType<typeof createClient>) {
  // Default: not verified (fail-safe)
  const out = {
    verified: false,
    source: "none" as "none" | "passengers",
    note: "" as string,
  };

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (!user) {
    out.note = "No auth user (not signed in).";
    return out;
  }

  const email = user.email ?? null;
  const userId = user.id;

  // We DO NOT assume your passengers schema. We try common patterns and fail safe if not found.
  // Pattern A: passengers.auth_user_id = user.id
  // Pattern B: passengers.user_id = user.id
  // Pattern C: passengers.email = user.email
  // Columns we try to read if present: is_verified, verified, verification_tier
  const selectors = "is_verified,verified,verification_tier";

  async function tryQuery(filterCol: "auth_user_id" | "user_id" | "email", filterVal: string) {
    const q = supabase.from("passengers").select(selectors).eq(filterCol, filterVal).limit(1).maybeSingle();
    return await q;
  }

  // Try auth_user_id
  {
    const r = await tryQuery("auth_user_id", userId);
    if (!r.error && r.data) {
      const row: any = r.data;
      out.verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
      out.source = "passengers";
      out.note = "Matched passengers.auth_user_id";
      return out;
    }
  }

  // Try user_id
  {
    const r = await tryQuery("user_id", userId);
    if (!r.error && r.data) {
      const row: any = r.data;
      out.verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
      out.source = "passengers";
      out.note = "Matched passengers.user_id";
      return out;
    }
  }

  // Try email
  if (email) {
    const r = await tryQuery("email", email);
    if (!r.error && r.data) {
      const row: any = r.data;
      out.verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
      out.source = "passengers";
      out.note = "Matched passengers.email";
      return out;
    }
  }

  // If we reached here, either no matching passenger row or schema differs or RLS blocks.
  out.note = "Could not resolve verification from passengers (no match, schema differs, or RLS blocked). Defaulting to unverified.";
  return out;
}

export async function GET() {
  const supabase = createClient();

  const nightGate = isNightGateNow();
  const v = await resolvePassengerVerification(supabase);

  return NextResponse.json(
    {
      ok: true,
      nightGate,
      window: "20:00-05:00 Asia/Manila",
      verified: v.verified,
      verification_source: v.source,
      verification_note: v.note,
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as CanBookReq;

  const nightGate = isNightGateNow();
  const v = await resolvePassengerVerification(supabase);

  if (nightGate && !v.verified) {
    return NextResponse.json(
      {
        ok: false,
        code: "NIGHT_GATE_UNVERIFIED",
        message: "Booking is restricted from 8PM to 5AM unless verified.",
        nightGate: true,
        window: "20:00-05:00 Asia/Manila",
        verified: false,
        verification_source: v.source,
        verification_note: v.note,
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
      verified: v.verified,
      verification_source: v.source,
      verification_note: v.note,
    },
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

type CanBookInfo = {
  ok?: boolean;
  nightGate?: boolean;
  window?: string;
  verified?: boolean;
  verification_source?: string;
  verification_note?: string;
  code?: string;
  message?: string;
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

  const [fromLabel, setFromLabel] = React.useState("Lagawe Public Market");
  const [toLabel, setToLabel] = React.useState("Lagawe Town Plaza");

  const [pickupLat, setPickupLat] = React.useState("16.7999");
  const [pickupLng, setPickupLng] = React.useState("121.1175");
  const [dropLat, setDropLat] = React.useState("16.8016");
  const [dropLng, setDropLng] = React.useState("121.1222");

  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string>("");

  const [canInfo, setCanInfo] = React.useState<CanBookInfo | null>(null);
  const [canInfoErr, setCanInfoErr] = React.useState<string>("");

  async function getJson(url: string) {
    const r = await fetch(url, { method: "GET" });
    const j = (await r.json().catch(() => ({}))) as any;
    return { ok: r.ok, status: r.status, json: j };
  }

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    return { ok: r.ok, status: r.status, json: j };
  }

  async function refreshCanBook() {
    setCanInfoErr("");
    try {
      const r = await getJson("/api/public/passenger/can-book");
      if (!r.ok) {
        setCanInfoErr("CAN_BOOK_INFO_FAILED: HTTP " + r.status);
        setCanInfo(null);
        return;
      }
      setCanInfo(r.json as CanBookInfo);
    } catch (e: any) {
      setCanInfoErr("CAN_BOOK_INFO_ERROR: " + String(e?.message || e));
      setCanInfo(null);
    }
  }

  React.useEffect(() => {
    refreshCanBook();
  }, []);

  async function submit() {
    setResult("");
    setBusy(true);
    try {
      // 1) Can-book check (verification is server-side in Phase 6B)
      const can = await postJson("/api/public/passenger/can-book", {
        town,
        service: "ride",
      });

      if (!can.ok) {
        const cj = can.json as CanBookInfo;
        setResult("CAN_BOOK_BLOCKED: " + (cj.code || "BLOCKED") + " - " + (cj.message || "Not allowed"));
        await refreshCanBook();
        return;
      }

      // 2) Create booking (unchanged)
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
      await refreshCanBook();
    } catch (e: any) {
      setResult("ERROR: " + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const verified = !!canInfo?.verified;
  const nightGate = !!canInfo?.nightGate;

  function pill(text: string, good: boolean) {
    return (
      <span className={"inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold " + (good ? "bg-green-600 text-white" : "bg-slate-200 text-slate-800")}>
        {text}
      </span>
    );
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
          Phase 6B: verification tier is now enforced server-side. Night gate: {canInfo?.window || "20:00-05:00 Asia/Manila"}.
        </p>

        <div className="mt-3 flex flex-wrap gap-2 items-center">
          {pill("Verified: " + (verified ? "YES" : "NO"), verified)}
          {pill("Night gate now: " + (nightGate ? "ON" : "OFF"), !nightGate)}
          <button
            type="button"
            onClick={refreshCanBook}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-1 text-xs font-semibold"
          >
            Refresh status
          </button>
        </div>

        {canInfoErr ? (
          <div className="mt-3 text-xs font-mono whitespace-pre-wrap rounded-xl border border-black/10 p-3">
            {canInfoErr}
          </div>
        ) : null}

        {canInfo?.verification_note ? (
          <div className="mt-3 text-xs opacity-70 rounded-xl border border-black/10 p-3">
            <div className="font-semibold">Verification lookup</div>
            <div className="mt-1">
              Source: <span className="font-mono">{String(canInfo.verification_source || "")}</span>
            </div>
            <div className="mt-1">{String(canInfo.verification_note || "")}</div>
          </div>
        ) : null}

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

            <div className="mt-3 text-xs opacity-70">
              Verified is determined from your passengers table + auth user (no manual toggle).
            </div>
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
          Next Phase 6: wallet precheck, then driver assignment hook, then status lifecycle.
        </div>
      </div>
    </main>
  );
}
'@

WriteUtf8NoBom $canBookRoute $canBookTs
WriteUtf8NoBom $ridePage $rideTs

Write-Host "[OK] Wrote: $canBookRoute"
Write-Host "[OK] Wrote: $ridePage"
Write-Host "[NEXT] Build: npm.cmd run build"
