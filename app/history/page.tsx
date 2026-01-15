"use client";

import React, { useEffect, useMemo, useState } from "react";
import BottomNavigation from "@/components/BottomNavigation";

type TripStatus = "completed" | "cancelled" | "pending" | string;

type TripSummary = {
  ref: string; // Trip Reference / booking code
  dateLabel: string;
  service: "Ride";
  pickup: string;
  dropoff: string;
  payment: "Cash" | "Wallet" | string;
  farePhp?: number;
  distanceKm?: number;
  status: TripStatus;
  _raw?: any;
};

function normalizeText(v: any): string {
  if (v === null || typeof v === "undefined") return "â€”";
  if (typeof v !== "string") return String(v);

  return v
    .replace(/Ã¢â€šÂ±/g, "â‚±")
    .replace(/Ã¢â‚¬â€/g, "â€”")
    .replace(/Ã¢â‚¬â€œ/g, "â€“")
    .replace(/Ã‚Â·/g, "Â·")
    .replace(/Ã¢â‚¬Ëœ|Ã¢â‚¬â„¢/g, "'")
    .replace(/Ã¢â‚¬Å“|Ã¢â‚¬ /g, '"')
    .replace(/Ã‚/g, "")
    .trim();
}

function peso(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return "â€”";
  return "â‚±" + n.toFixed(2);
}

function km(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return "â€”";
  return n.toFixed(1) + " km";
}

function safeStr(v: any, fallback = ""): string {
  if (v === null || typeof v === "undefined") return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return fallback;
  }
}

function safeNum(v: any): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (isFinite(n)) return n;
  }
  return undefined;
}

function pickFirst(obj: any, keys: string[]): any {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== null &&
      typeof obj[k] !== "undefined"
    ) {
      return obj[k];
    }
  }
  return undefined;
}

function fmtDateLabel(v: any): string {
  const s = safeStr(v, "");
  const d = s ? new Date(s) : null;
  if (d && !isNaN(d.getTime())) {
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return s || "â€”";
}

function buildReceiptText(t: TripSummary) {
  const lines: string[] = [];
  lines.push("JRIDE TRIP RECEIPT");
  lines.push("Trip Reference: " + normalizeText(t.ref));
  lines.push("Date: " + normalizeText(t.dateLabel));
  lines.push("Service: " + t.service);
  lines.push("Status: " + normalizeText(safeStr(t.status, "")).toUpperCase());
  lines.push("");
  lines.push("Pickup: " + normalizeText(t.pickup));
  lines.push("Dropoff: " + normalizeText(t.dropoff));
  lines.push("");
  if (typeof t.distanceKm === "number") lines.push("Distance: " + normalizeText(km(t.distanceKm)));
  if (typeof t.farePhp === "number") lines.push("Fare: " + normalizeText(peso(t.farePhp)));
  lines.push("Payment Clearing: " + normalizeText(safeStr(t.payment, "â€”")));
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

function normalizeTrips(payload: any): TripSummary[] {
  const arr: any[] =
    (Array.isArray(payload) ? payload : null) ||
    (payload && Array.isArray(payload.rides) ? payload.rides : null) ||
    (payload && Array.isArray(payload.data) ? payload.data : null) ||
    (payload && Array.isArray(payload.items) ? payload.items : null) ||
    [];

  const out: TripSummary[] = arr.map((r) => {
    const ref = safeStr(
      pickFirst(r, ["booking_code", "code", "ref", "reference", "bookingCode", "trip_code", "id"]),
      "â€”"
    );

    const pickup = safeStr(
      pickFirst(r, ["from_label", "pickup_address", "pickup", "from_address", "from", "origin"]),
      "â€”"
    );

    const dropoff = safeStr(
      pickFirst(r, ["to_label", "dropoff_address", "dropoff", "to_address", "to", "destination"]),
      "â€”"
    );

    const farePhp =
      safeNum(pickFirst(r, ["verified_fare"])) ??
      safeNum(pickFirst(r, ["passenger_fare_response"])) ??
      safeNum(pickFirst(r, ["proposed_fare"])) ??
      safeNum(pickFirst(r, ["fare", "fare_php", "farePhp", "amount", "total_fare", "total"]));

    const distanceKm = safeNum(pickFirst(r, ["distance_km", "distanceKm", "distance", "km"]));

    const status = safeStr(pickFirst(r, ["status", "ride_status", "state"]), "pending");

    const payment = safeStr(
      pickFirst(r, ["payment_method", "payment", "paymentMethod", "paid_via", "payment_mode"]),
      "â€”"
    );

    const created = pickFirst(r, ["created_at", "requested_at", "started_at", "completed_at", "updated_at"]);
    const dateLabel = fmtDateLabel(created);

    return {
      ref: normalizeText(ref),
      dateLabel: normalizeText(dateLabel),
      service: "Ride",
      pickup: normalizeText(pickup),
      dropoff: normalizeText(dropoff),
      payment: normalizeText(payment),
      farePhp,
      distanceKm,
      status: normalizeText(status),
      _raw: r,
    };
  });

  const completed = out.filter((t) => String(t.status).toLowerCase() === "completed");
  if (completed.length > 0) return completed;

  const doneLike = out.filter((t) => {
    const s = String(t.status).toLowerCase();
    return s === "done" || s === "finished" || s === "complete";
  });
  if (doneLike.length > 0) return doneLike;

  return out;
}

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState("history");

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string>("");
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [selectedRef, setSelectedRef] = useState<string>("");

  const [toast, setToast] = useState<string>("");

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setLoadErr("");
      try {
        const res = await fetch("/api/rides/list", { method: "GET", cache: "no-store" });
        const j = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = normalizeText(safeStr(j?.error, "")) || ("HTTP " + res.status);
          throw new Error(msg);
        }

        const norm = normalizeTrips(j);
        if (!alive) return;

        setTrips(norm);
        setSelectedRef((prev) => {
          if (prev && norm.some((t) => t.ref === prev)) return prev;
          return norm[0]?.ref || "";
        });
      } catch (e: any) {
        if (!alive) return;
        setLoadErr(normalizeText(e?.message || "Failed to load trips."));
        setTrips([]);
        setSelectedRef("");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, []);

  const selectedTrip = useMemo(() => {
    if (!selectedRef) return null;
    return trips.find((t) => t.ref === selectedRef) || null;
  }, [trips, selectedRef]);

  async function onCopy(trip: TripSummary) {
    const ok = await copyToClipboard(buildReceiptText(trip));
    setToast(ok ? "Copied receipt text." : "Copy failed on this browser.");
    window.setTimeout(() => setToast(""), 1800);
  }

  async function onShare(trip: TripSummary) {
    const text = buildReceiptText(trip);

    try {
      const anyNav: any = navigator as any;
      if (anyNav?.share) {
        await anyNav.share({ title: "JRide Trip Receipt", text });
        setToast("Share opened.");
        window.setTimeout(() => setToast(""), 1800);
        return;
      }
    } catch {
      // fall back
    }

    const ok = await copyToClipboard(text);
    setToast(ok ? "Share not available â€” copied instead." : "Share/copy failed.");
    window.setTimeout(() => setToast(""), 1800);
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Ride History</h1>
            <div className="text-sm opacity-70">View completed trips and share receipts.</div>
          </div>

          {toast && (
            <div className="text-xs rounded-full border border-black/10 bg-white px-3 py-1 shadow-sm">
              {toast}
            </div>
          )}
        </div>

        {loading && (
          <div className="mt-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm text-sm opacity-70">
            Loading tripsâ€¦
          </div>
        )}

        {!loading && loadErr && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm text-sm text-red-700">
            Failed to load trips: {loadErr}
          </div>
        )}

        {!loading && !loadErr && trips.length === 0 && (
          <div className="mt-4 rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
            <div className="font-semibold">No completed trips yet</div>
            <div className="text-sm opacity-70 mt-1">
              Once you complete a ride, it will appear here with a shareable receipt.
            </div>
          </div>
        )}

        {!loading && !loadErr && trips.length > 0 && (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="font-semibold mb-2">Trips</div>

              <div className="space-y-2">
                {trips.map((t) => {
                  const active = t.ref === selectedRef;
                  return (
                    <button
                      key={t.ref}
                      type="button"
                      onClick={() => setSelectedRef(t.ref)}
                      className={
                        "w-full text-left rounded-xl border px-3 py-3 transition " +
                        (active ? "border-blue-600 bg-blue-50" : "border-black/10 hover:bg-black/5")
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold">
                          {normalizeText(t.ref)}{" "}
                          <span className="text-xs opacity-60 font-normal">Â· {t.service}</span>
                        </div>
                        <span
                          className={
                            "text-xs rounded-full px-2 py-0.5 border " +
                            (String(t.status).toLowerCase() === "completed"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : String(t.status).toLowerCase() === "cancelled"
                              ? "border-red-200 bg-red-50 text-red-700"
                              : "border-amber-200 bg-amber-50 text-amber-700")
                          }
                        >
                          {normalizeText(t.status)}
                        </span>
                      </div>

                      <div className="text-xs opacity-70 mt-1">{normalizeText(t.dateLabel)}</div>
                      <div className="text-sm mt-2">
                        <div className="truncate">
                          <span className="opacity-70">From:</span> {normalizeText(t.pickup)}
                        </div>
                        <div className="truncate">
                          <span className="opacity-70">To:</span> {normalizeText(t.dropoff)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 text-xs opacity-60">Showing trips from /api/rides/list.</div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">Receipt</div>
                  <div className="text-xs opacity-60">Passenger-side receipt (wired)</div>
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
                  <div className="rounded-2xl border border-black/10 bg-gray-50 p-4">
                    <div className="text-xs opacity-70">Trip Reference</div>
                    <div className="text-2xl font-extrabold tracking-tight">{normalizeText(selectedTrip.ref)}</div>
                    <div className="text-xs opacity-60 mt-1">{normalizeText(selectedTrip.dateLabel)}</div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-black/10 p-3">
                      <div className="text-xs opacity-60">Pickup</div>
                      <div className="font-semibold">{normalizeText(selectedTrip.pickup)}</div>
                    </div>
                    <div className="rounded-xl border border-black/10 p-3">
                      <div className="text-xs opacity-60">Dropoff</div>
                      <div className="font-semibold">{normalizeText(selectedTrip.dropoff)}</div>
                    </div>

                    <div className="rounded-xl border border-black/10 p-3">
                      <div className="text-xs opacity-60">Fare</div>
                      <div className="font-semibold">{normalizeText(peso(selectedTrip.farePhp))}</div>
                    </div>
                    <div className="rounded-xl border border-black/10 p-3">
                      <div className="text-xs opacity-60">Distance</div>
                      <div className="font-semibold">{normalizeText(km(selectedTrip.distanceKm))}</div>
                    </div>

                    <div className="rounded-xl border border-black/10 p-3">
                      <div className="text-xs opacity-60">Payment</div>
                      <div className="font-semibold">{normalizeText(selectedTrip.payment)}</div>
                    </div>
                    <div className="rounded-xl border border-black/10 p-3">
                      <div className="text-xs opacity-60">Status</div>
                      <div className="font-semibold">{normalizeText(selectedTrip.status)}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-xs opacity-60">Layout unchanged â€” mojibake cleaned at render.</div>
                </div>
              ) : (
                <div className="mt-4 text-sm opacity-70">No trip selected.</div>
              )}
            </div>
          </div>
        )}
      </div>

      <BottomNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}