# PATCH-JRIDE_PASSENGER_P3C_A_PLUS_C_V1.ps1
# A) /ride prefill from ?from=&to= (UI-only)
# C) /history/[ref] trip details page (UI-only, localStorage cache)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

function WriteUtf8NoBom([string]$path, [string]$content) {
  [System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

$root = (Get-Location).Path

$history = Join-Path $root "app\history\page.tsx"
$ride    = Join-Path $root "app\ride\page.tsx"
$detailDir = Join-Path $root "app\history\[ref]"
$detailPage = Join-Path $detailDir "page.tsx"

if (!(Test-Path $history)) { Fail ("Missing file: " + $history) }
if (!(Test-Path $ride)) { Fail ("Missing file: " + $ride) }

# ------------------------------
# BACKUPS
# ------------------------------
$stamp = Stamp
$bak1 = "$history.bak.$stamp"
$bak2 = "$ride.bak.$stamp"
Copy-Item -LiteralPath $history -Destination $bak1 -Force
Copy-Item -LiteralPath $ride -Destination $bak2 -Force
Write-Host ("[OK] Backup: " + $bak1) -ForegroundColor Green
Write-Host ("[OK] Backup: " + $bak2) -ForegroundColor Green

# ============================================================
# PATCH 1: app\history\page.tsx
# - Add LAST_TRIPS_KEY constant near FAV_KEY (module scope)
# - Add useEffect to cache trips into localStorage
# - Add "Open details" button near receipt actions (safe)
# ============================================================
$htxt = Get-Content -Raw -LiteralPath $history

if ($htxt.IndexOf("JRIDE_P3C_A_PLUS_C_BEGIN", [StringComparison]::Ordinal) -ge 0) {
  Fail "History patch already applied: JRIDE_P3C_A_PLUS_C_BEGIN found."
}

# anchors we know exist in your real file (from your Select-String output)
if ($htxt.IndexOf("function buildReceiptText", [StringComparison]::Ordinal) -lt 0) { Fail "Anchor not found in history: function buildReceiptText" }
if ($htxt.IndexOf('placeholder="Search Trip Reference...', [StringComparison]::Ordinal) -lt 0) { Fail "Anchor not found in history: Search Trip Reference placeholder" }
if ($htxt.IndexOf("function onPrint(trip", [StringComparison]::Ordinal) -lt 0) { Fail "Anchor not found in history: function onPrint(trip" }
if ($htxt.IndexOf("onClick={() => onPrint(selectedTrip)}", [StringComparison]::Ordinal) -lt 0) { Fail "Anchor not found in history: onClick={() => onPrint(selectedTrip)}" }

# A) Insert LAST_TRIPS_KEY under existing FAV_KEY (module scope)
$idxFavKey = $htxt.IndexOf("FAV_KEY", [StringComparison]::Ordinal)
if ($idxFavKey -lt 0) { Fail "Anchor not found in history: FAV_KEY" }

# Find end of that line
$idxFavLineEnd = $htxt.IndexOf("`n", $idxFavKey)
if ($idxFavLineEnd -lt 0) { Fail "Could not find newline after FAV_KEY line" }

$constBlock = @'
const LAST_TRIPS_KEY = "JRIDE_LAST_TRIPS_V1";
/* ================= JRIDE_P3C_A_PLUS_C_BEGIN =================
   UI-only:
   - Cache last loaded trips (for /history/[ref])
   - Add "Open details" button
   No backend. No schema. No Mapbox changes.
============================================================== */
'@

$htxt = $htxt.Substring(0, $idxFavLineEnd + 1) + $constBlock + "`r`n" + $htxt.Substring($idxFavLineEnd + 1)

# B) Insert useEffect that caches trips -> localStorage
# We place it after the trips state declaration if found; fallback after router.
$insertPos = -1

$idxTripsState = $htxt.IndexOf("const [trips", [StringComparison]::Ordinal)
if ($idxTripsState -ge 0) {
  $idxAfterTripsLine = $htxt.IndexOf("`n", $idxTripsState)
  if ($idxAfterTripsLine -ge 0) { $insertPos = $idxAfterTripsLine + 1 }
}

if ($insertPos -lt 0) {
  $idxRouter = $htxt.IndexOf("const router", [StringComparison]::Ordinal)
  if ($idxRouter -lt 0) { Fail "Could not locate insertion point (no const [trips ...] and no const router)" }
  $idxAfterRouterLine = $htxt.IndexOf("`n", $idxRouter)
  if ($idxAfterRouterLine -lt 0) { Fail "Could not find newline after router line" }
  $insertPos = $idxAfterRouterLine + 1
}

$cacheEffect = @'
  // P3C: cache last loaded trips for /history/[ref] (UI-only)
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      // Keep it small + safe: only cache arrays
      // @ts-ignore
      if (Array.isArray(trips)) window.localStorage.setItem(LAST_TRIPS_KEY, JSON.stringify(trips));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);
'@

$htxt = $htxt.Substring(0, $insertPos) + $cacheEffect + "`r`n" + $htxt.Substring($insertPos)

# C) Add "Open details" button after Print button (receipt actions area)
$idxPrintClick = $htxt.IndexOf("onClick={() => onPrint(selectedTrip)}", [StringComparison]::Ordinal)
if ($idxPrintClick -lt 0) { Fail "Could not locate print click anchor after edits" }

$idxAfterPrintBtn = $htxt.IndexOf("</button>", $idxPrintClick, [StringComparison]::Ordinal)
if ($idxAfterPrintBtn -lt 0) { Fail "Could not locate </button> after Print" }
$idxAfterPrintBtn = $idxAfterPrintBtn + "</button>".Length

# Insert on next line boundary for clean formatting
$nl = $htxt.IndexOf("`n", $idxAfterPrintBtn)
if ($nl -ge 0) { $idxAfterPrintBtn = $nl + 1 }

$openDetailsBtn = @'
                      <button
                        type="button"
                        disabled={!selectedTrip}
                        onClick={() => {
                          if (!selectedTrip) return;
                          try {
                            if (typeof window !== "undefined") {
                              // cache once more to improve reliability
                              // @ts-ignore
                              if (Array.isArray(trips)) window.localStorage.setItem(LAST_TRIPS_KEY, JSON.stringify(trips));
                            }
                          } catch {}
                          router.push("/history/" + encodeURIComponent(String((selectedTrip as any).ref || "")));
                        }}
                        className={
                          "rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold " +
                          (!selectedTrip ? "opacity-50" : "hover:bg-black/5")
                        }
                        title="Open trip details page"
                      >
                        Open details
                      </button>
'@

$htxt = $htxt.Substring(0, $idxAfterPrintBtn) + $openDetailsBtn + "`r`n" + $htxt.Substring($idxAfterPrintBtn)

WriteUtf8NoBom $history $htxt
Write-Host ("[OK] Patched: " + $history) -ForegroundColor Green

# ============================================================
# PATCH 2: app\ride\page.tsx
# - Prefill from/to labels from URL query (UI-only)
# - No Mapbox changes, no IIFE
# ============================================================
$rtxt = Get-Content -Raw -LiteralPath $ride

if ($rtxt.IndexOf("JRIDE_P3C_RIDE_PREFILL_BEGIN", [StringComparison]::Ordinal) -ge 0) {
  Fail "Ride patch already applied: JRIDE_P3C_RIDE_PREFILL_BEGIN found."
}

# anchors: ensure these exist
$idxFrom = $rtxt.IndexOf("setFromLabel", [StringComparison]::Ordinal)
$idxTo   = $rtxt.IndexOf("setToLabel", [StringComparison]::Ordinal)
if ($idxFrom -lt 0 -or $idxTo -lt 0) { Fail "Ride page missing setFromLabel/setToLabel (cannot safely patch)" }

# Prefer insert AFTER the toLabel state line: find first occurrence of "const [toLabel" (or "const [toLabel,")
$idxToState = $rtxt.IndexOf("const [toLabel", [StringComparison]::Ordinal)
if ($idxToState -lt 0) {
  # fallback: after fromLabel line
  $idxToState = $rtxt.IndexOf("const [fromLabel", [StringComparison]::Ordinal)
}
if ($idxToState -lt 0) { Fail "Could not locate fromLabel/toLabel state declaration in ride page" }

$idxToStateEol = $rtxt.IndexOf("`n", $idxToState)
if ($idxToStateEol -lt 0) { Fail "Could not find newline after label state line in ride page" }
$rideInsertPos = $idxToStateEol + 1

$ridePrefill = @'
  /* ================= JRIDE_P3C_RIDE_PREFILL_BEGIN =================
     UI-only: Prefill pickup/dropoff labels from /ride?from=&to=
     No backend. No schema. No Mapbox edits.
  ================================================================== */
  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const sp = new URLSearchParams(window.location.search || "");
      const f = String(sp.get("from") || "").trim();
      const t = String(sp.get("to") || "").trim();
      // Only set if provided (do not overwrite user typing)
      if (f) setFromLabel(f);
      if (t) setToLabel(t);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* ================== JRIDE_P3C_RIDE_PREFILL_END ================== */
'@

$rtxt = $rtxt.Substring(0, $rideInsertPos) + $ridePrefill + "`r`n" + $rtxt.Substring($rideInsertPos)

WriteUtf8NoBom $ride $rtxt
Write-Host ("[OK] Patched: " + $ride) -ForegroundColor Green

# ============================================================
# CREATE: app\history\[ref]\page.tsx
# - UI-only details view reading LAST_TRIPS_KEY from localStorage
# - Receipt actions + Ride again
# ============================================================
if (!(Test-Path $detailDir)) {
  New-Item -ItemType Directory -Force -Path $detailDir | Out-Null
}

$detail = @'
"use client";

import React from "react";
import { useRouter } from "next/navigation";

type TripStatus = "completed" | "cancelled" | "pending" | string;

type TripSummary = {
  ref: string;
  dateLabel: string;
  service: string;
  pickup: string;
  dropoff: string;
  payment?: string;
  farePhp?: number;
  distanceKm?: number;
  status: TripStatus;
  sortTs?: number;
  _raw?: any;
};

const EMPTY = "--";
const LAST_TRIPS_KEY = "JRIDE_LAST_TRIPS_V1";

function normalizeText(v: any): string {
  if (v === null || typeof v === "undefined") return EMPTY;
  let s = typeof v === "string" ? v : String(v);
  // remove non-ASCII last resort (prevents mojibake remnants)
  s = s.replace(/[^\x20-\x7E]/g, "").trim();
  return s || EMPTY;
}

function peso(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return EMPTY;
  return "PHP " + n.toFixed(2);
}

function fareLabel(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return EMPTY;
  if (Math.abs(n) < 0.000001) return "Free ride";
  return peso(n);
}

function km(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return EMPTY;
  return n.toFixed(1) + " km";
}

function buildReceiptText(t: TripSummary) {
  const lines: string[] = [];
  lines.push("JRIDE TRIP RECEIPT");
  lines.push("Trip Reference: " + normalizeText(t.ref));
  lines.push("Date: " + normalizeText(t.dateLabel));
  lines.push("Service: " + normalizeText(t.service));
  lines.push("Status: " + normalizeText(String(t.status || "")).toUpperCase());
  lines.push("");
  lines.push("Pickup: " + normalizeText(t.pickup));
  lines.push("Dropoff: " + normalizeText(t.dropoff));
  lines.push("");
  if (typeof t.distanceKm === "number") lines.push("Distance: " + km(t.distanceKm));
  if (typeof t.farePhp === "number") lines.push("Fare: " + fareLabel(t.farePhp));
  if (t.payment) lines.push("Payment: " + normalizeText(t.payment));
  lines.push("");
  lines.push("Thank you for riding with JRide.");
  return lines.join("\n");
}

async function copyToClipboard(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
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

function downloadTextFile(filename: string, text: string) {
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

function printReceipt(title: string, text: string) {
  try {
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return false;

    const esc = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 24px; }
  .card { border: 1px solid #ddd; border-radius: 12px; padding: 18px; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  pre { white-space: pre-wrap; font-size: 13px; line-height: 1.4; margin: 0; }
  .hint { opacity: 0.6; font-size: 12px; margin-top: 10px; }
  @media print { .hint { display: none; } body { padding: 0; } .card { border: none; } }
</style>
</head>
<body>
  <div class="card">
    <h1>${esc(title)}</h1>
    <pre>${esc(text)}</pre>
    <div class="hint">Print dialog should open automatically.</div>
  </div>
  <script>window.print();</script>
</body>
</html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    return true;
  } catch {
    return false;
  }
}

export default function TripDetailPage(props: { params: { ref: string } }) {
  const router = useRouter();
  const ref = String(props?.params?.ref || "").trim();

  const [trip, setTrip] = React.useState<TripSummary | null>(null);
  const [toast, setToast] = React.useState<string>("");

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const raw = window.localStorage.getItem(LAST_TRIPS_KEY);
      if (!raw) { setTrip(null); return; }
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) { setTrip(null); return; }
      const found = arr.find((x: any) => String(x?.ref || "") === ref) || null;
      setTrip(found);
    } catch {
      setTrip(null);
    }
  }, [ref]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t as any);
  }, [toast]);

  function rideAgain(from: string, to: string) {
    const f = String(from || "").trim();
    const t = String(to || "").trim();
    if (!f || !t) { setToast("Missing pickup/dropoff."); return; }
    router.push("/ride?from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t));
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="p-4 max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Trip Details</h1>
            <div className="text-sm opacity-70">Trip Reference: <span className="font-mono">{normalizeText(ref)}</span></div>
          </div>
          <button
            type="button"
            onClick={() => router.push("/history")}
            className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/5"
          >
            Back
          </button>
        </div>

        {toast ? (
          <div className="mt-3 text-xs rounded-full border border-black/10 bg-white px-3 py-1 shadow-sm inline-block">
            {toast}
          </div>
        ) : null}

        {!trip ? (
          <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
            <div className="font-semibold">Trip not found on this device</div>
            <div className="text-sm opacity-70 mt-1">
              Please go back to History to reload your trips.
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="text-sm opacity-70">Date</div>
              <div className="font-semibold">{normalizeText(trip.dateLabel)}</div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-black/10 p-3">
                  <div className="text-xs opacity-60">Pickup</div>
                  <div className="font-semibold">{normalizeText(trip.pickup)}</div>
                </div>
                <div className="rounded-xl border border-black/10 p-3">
                  <div className="text-xs opacity-60">Dropoff</div>
                  <div className="font-semibold">{normalizeText(trip.dropoff)}</div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-black/10 p-3">
                  <div className="text-xs opacity-60">Fare</div>
                  <div className="font-semibold">{fareLabel(trip.farePhp)}</div>
                </div>
                <div className="rounded-xl border border-black/10 p-3">
                  <div className="text-xs opacity-60">Distance</div>
                  <div className="font-semibold">{typeof trip.distanceKm === "number" ? km(trip.distanceKm) : EMPTY}</div>
                </div>
                <div className="rounded-xl border border-black/10 p-3">
                  <div className="text-xs opacity-60">Status</div>
                  <div className="font-semibold">{normalizeText(trip.status)}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyToClipboard(buildReceiptText(trip));
                    setToast(ok ? "Copied receipt text." : "Copy failed.");
                  }}
                  className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/5"
                >
                  Copy
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const text = buildReceiptText(trip);
                    try {
                      const anyNav: any = navigator as any;
                      if (anyNav?.share) {
                        await anyNav.share({ title: "JRide Trip Receipt", text });
                        setToast("Share opened.");
                        return;
                      }
                    } catch {}
                    const ok = await copyToClipboard(text);
                    setToast(ok ? "Share not available - copied instead." : "Share/copy failed.");
                  }}
                  className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/5"
                >
                  Share
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const text = buildReceiptText(trip);
                    const fn = "JRIDE_RECEIPT_" + normalizeText(trip.ref).replace(/[^A-Za-z0-9_-]/g, "_") + ".txt";
                    const ok = downloadTextFile(fn, text);
                    setToast(ok ? "Downloaded receipt." : "Download failed.");
                  }}
                  className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/5"
                >
                  Download
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const text = buildReceiptText(trip);
                    const title = "JRide Receipt - " + normalizeText(trip.ref);
                    const ok = printReceipt(title, text);
                    setToast(ok ? "Print opened." : "Print popup blocked.");
                  }}
                  className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/5"
                >
                  Print
                </button>

                <button
                  type="button"
                  onClick={() => rideAgain(trip.pickup, trip.dropoff)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/5"
                  title="Go to Ride page with same pickup/dropoff"
                >
                  Ride again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
'@

WriteUtf8NoBom $detailPage $detail
Write-Host ("[OK] Created: " + $detailPage) -ForegroundColor Green

Write-Host "[DONE] P3C A+C applied (UI-only)." -ForegroundColor Green
