# PATCH-JRIDE_P2B_R_PASSENGER_HISTORY_RECEIPT_SHELL.ps1
# UI ONLY. No backend. No Mapbox. No IIFE JSX. Full-file replacement.
# Target: app/history/page.tsx

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }

$root = (Get-Location).Path
$target = Join-Path $root "app\history\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

# NOTE: Write UTF-8 (no BOM)
$content = @'
"use client";

import React, { useMemo, useState } from "react";
import BottomNavigation from "@/components/BottomNavigation";

type TripStatus = "completed" | "cancelled" | "pending";

type TripSummary = {
  ref: string;            // Trip Reference / booking code
  dateLabel: string;      // UI label only
  service: "Ride";        // keep simple for now
  pickup: string;
  dropoff: string;
  payment: "Cash" | "Wallet";
  farePhp?: number;       // optional for now
  distanceKm?: number;    // optional for now
  status: TripStatus;
};

function peso(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  // Keep formatting simple and stable
  return "₱" + n.toFixed(2);
}

function km(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return n.toFixed(1) + " km";
}

function buildReceiptText(t: TripSummary) {
  const lines: string[] = [];
  lines.push("JRIDE TRIP RECEIPT");
  lines.push("Trip Reference: " + t.ref);
  lines.push("Date: " + t.dateLabel);
  lines.push("Service: " + t.service);
  lines.push("Status: " + t.status.toUpperCase());
  lines.push("");
  lines.push("Pickup: " + t.pickup);
  lines.push("Dropoff: " + t.dropoff);
  lines.push("");
  if (typeof t.distanceKm === "number") lines.push("Distance: " + km(t.distanceKm));
  if (typeof t.farePhp === "number") lines.push("Fare: " + peso(t.farePhp));
  lines.push("Payment: " + t.payment);
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
  } catch {
    // fall through
  }

  // Fallback (older browsers)
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

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState("history");

  // UI-only placeholder list (no API calls). Replace later with real trip data.
  const demoTrips: TripSummary[] = useMemo(
    () => [
      {
        ref: "JR-2026-0001",
        dateLabel: "Jan 14, 2026 · 9:10 PM",
        service: "Ride",
        pickup: "Lagawe Public Market",
        dropoff: "Lamut Municipal Hall",
        payment: "Cash",
        farePhp: 120,
        distanceKm: 9.3,
        status: "completed",
      },
      {
        ref: "JR-2026-0002",
        dateLabel: "Jan 12, 2026 · 6:42 PM",
        service: "Ride",
        pickup: "Banaue Viewpoint",
        dropoff: "Kiangan Town Plaza",
        payment: "Wallet",
        farePhp: 260,
        distanceKm: 18.7,
        status: "completed",
      },
    ],
    []
  );

  const [selectedRef, setSelectedRef] = useState<string>(demoTrips[0]?.ref || "");
  const selectedTrip = useMemo(
    () => demoTrips.find((t) => t.ref === selectedRef) || demoTrips[0],
    [demoTrips, selectedRef]
  );

  const [toast, setToast] = useState<string>("");

  async function onCopy(trip: TripSummary) {
    const ok = await copyToClipboard(buildReceiptText(trip));
    setToast(ok ? "Copied receipt text." : "Copy failed on this browser.");
    window.setTimeout(() => setToast(""), 1800);
  }

  async function onShare(trip: TripSummary) {
    const text = buildReceiptText(trip);

    // Prefer Web Share API when available
    try {
      const anyNav: any = navigator as any;
      if (anyNav?.share) {
        await anyNav.share({
          title: "JRide Trip Receipt",
          text,
        });
        setToast("Share opened.");
        window.setTimeout(() => setToast(""), 1800);
        return;
      }
    } catch {
      // fall back to copy
    }

    const ok = await copyToClipboard(text);
    setToast(ok ? "Share not available — copied instead." : "Share/copy failed.");
    window.setTimeout(() => setToast(""), 1800);
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Ride History</h1>
            <div className="text-sm opacity-70">
              Receipt preview is UI-only for now (no backend calls).
            </div>
          </div>

          {toast && (
            <div className="text-xs rounded-full border border-black/10 bg-white px-3 py-1 shadow-sm">
              {toast}
            </div>
          )}
        </div>

        {/* Two-column on desktop: list + receipt */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* List */}
          <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="font-semibold mb-2">Trips</div>

            <div className="space-y-2">
              {demoTrips.map((t) => {
                const active = t.ref === selectedRef;
                return (
                  <button
                    key={t.ref}
                    type="button"
                    onClick={() => setSelectedRef(t.ref)}
                    className={
                      "w-full text-left rounded-xl border px-3 py-3 transition " +
                      (active
                        ? "border-blue-600 bg-blue-50"
                        : "border-black/10 hover:bg-black/5")
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">
                        {t.ref}{" "}
                        <span className="text-xs opacity-60 font-normal">· {t.service}</span>
                      </div>
                      <span
                        className={
                          "text-xs rounded-full px-2 py-0.5 border " +
                          (t.status === "completed"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : t.status === "cancelled"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-amber-200 bg-amber-50 text-amber-700")
                        }
                      >
                        {t.status}
                      </span>
                    </div>

                    <div className="text-xs opacity-70 mt-1">{t.dateLabel}</div>
                    <div className="text-sm mt-2">
                      <div className="truncate">
                        <span className="opacity-70">From:</span> {t.pickup}
                      </div>
                      <div className="truncate">
                        <span className="opacity-70">To:</span> {t.dropoff}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 text-xs opacity-60">
              Replace demo trips with real trip data later.
            </div>
          </div>

          {/* Receipt */}
          <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">Receipt</div>
                <div className="text-xs opacity-60">Passenger-side receipt shell (UI only)</div>
              </div>

              {selectedTrip && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onCopy(selectedTrip)}
                    className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-2 text-sm font-semibold"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => onShare(selectedTrip)}
                    className="rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 text-sm font-semibold"
                  >
                    Share
                  </button>
                </div>
              )}
            </div>

            {selectedTrip ? (
              <div className="mt-4">
                {/* Trip reference emphasis */}
                <div className="rounded-2xl border border-black/10 bg-gray-50 p-4">
                  <div className="text-xs opacity-70">Trip Reference</div>
                  <div className="text-2xl font-extrabold tracking-tight">{selectedTrip.ref}</div>
                  <div className="text-xs opacity-60 mt-1">{selectedTrip.dateLabel}</div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-black/10 p-3">
                    <div className="text-xs opacity-60">Pickup</div>
                    <div className="font-semibold">{selectedTrip.pickup}</div>
                  </div>
                  <div className="rounded-xl border border-black/10 p-3">
                    <div className="text-xs opacity-60">Dropoff</div>
                    <div className="font-semibold">{selectedTrip.dropoff}</div>
                  </div>

                  <div className="rounded-xl border border-black/10 p-3">
                    <div className="text-xs opacity-60">Fare</div>
                    <div className="font-semibold">{peso(selectedTrip.farePhp)}</div>
                  </div>
                  <div className="rounded-xl border border-black/10 p-3">
                    <div className="text-xs opacity-60">Distance</div>
                    <div className="font-semibold">{km(selectedTrip.distanceKm)}</div>
                  </div>

                  <div className="rounded-xl border border-black/10 p-3">
                    <div className="text-xs opacity-60">Payment</div>
                    <div className="font-semibold">{selectedTrip.payment}</div>
                  </div>
                  <div className="rounded-xl border border-black/10 p-3">
                    <div className="text-xs opacity-60">Status</div>
                    <div className="font-semibold">{selectedTrip.status}</div>
                  </div>
                </div>

                <div className="mt-4 text-xs opacity-60">
                  This receipt is currently UI-only. We’ll wire real data later without changing the layout.
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm opacity-70">No trip selected.</div>
            )}
          </div>
        </div>
      </div>

      <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}
'@

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
Ok "Wrote: $target"
Ok "Done."
