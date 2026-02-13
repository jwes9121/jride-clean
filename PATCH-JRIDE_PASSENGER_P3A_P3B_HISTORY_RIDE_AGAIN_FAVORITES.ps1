# PATCH-JRIDE_PASSENGER_P3A_P3B_HISTORY_RIDE_AGAIN_FAVORITES.ps1
# UI ONLY – P3A (Ride Again) + P3B (Favorites v1 via localStorage)
# Updates ONLY app/history/page.tsx. No backend. No Mapbox. No IIFE JSX.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = (Get-Location).Path
$target = Join-Path $root "app\history\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$content = @'
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BottomNavigation from "@/components/BottomNavigation";

type TripStatus = "completed" | "cancelled" | "pending" | string;

type TripSummary = {
  ref: string;
  dateLabel: string;
  service: "Ride";
  pickup: string;
  dropoff: string;
  payment?: string;
  farePhp?: number;
  distanceKm?: number;
  status: TripStatus;
  sortTs?: number;
  _raw?: any;
};

type FavRoute = {
  id: string;
  label: string; // Home/Work/Market/Custom text
  from: string;
  to: string;
  createdAt: number;
};

const EMPTY = "--";
const FAV_KEY = "JRIDE_FAVORITE_ROUTES_V1";

function normalizeText(v: any): string {
  if (v === null || typeof v === "undefined") return EMPTY;
  let s = typeof v === "string" ? v : String(v);

  // Strip known mojibake markers + any remaining non-ASCII chars.
  s = s
    .replace(//g, "")
    .replace(/Ã/g, "")
    .replace(/â/g, "")
    .trim();

  // Remove non-ASCII (last resort)
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

function parseTs(v: any): number | undefined {
  const s = safeStr(v, "");
  if (!s) return undefined;
  const d = new Date(s);
  const t = d.getTime();
  return isFinite(t) ? t : undefined;
}

function fmtDateLabel(v: any): string {
  const s = safeStr(v, "");
  const d = s ? new Date(s) : null;
  if (d && !isNaN(d.getTime())) {
    return normalizeText(
      d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }
  return normalizeText(s) || EMPTY;
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
  if (typeof t.distanceKm === "number") lines.push("Distance: " + km(t.distanceKm));
  if (typeof t.farePhp === "number") lines.push("Fare: " + fareLabel(t.farePhp));
  if (t.payment && normalizeText(t.payment) !== EMPTY) lines.push("Payment: " + normalizeText(t.payment));
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
  <script>
    window.focus();
    window.print();
  </script>
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

function computeFareFromComponents(r: any): number | undefined {
  const base = safeNum(pickFirst(r, ["base_fee"])) ?? 0;
  const dist = safeNum(pickFirst(r, ["distance_fare"])) ?? 0;
  const extraStop = safeNum(pickFirst(r, ["extra_stop_fee"])) ?? 0;
  const waiting = safeNum(pickFirst(r, ["waiting_fee"])) ?? 0;
  const errand = safeNum(pickFirst(r, ["total_errand_fee"])) ?? 0;

  const hasAny =
    typeof pickFirst(r, ["base_fee"]) !== "undefined" ||
    typeof pickFirst(r, ["distance_fare"]) !== "undefined" ||
    typeof pickFirst(r, ["extra_stop_fee"]) !== "undefined" ||
    typeof pickFirst(r, ["waiting_fee"]) !== "undefined" ||
    typeof pickFirst(r, ["total_errand_fee"]) !== "undefined";

  if (!hasAny) return undefined;

  const sum = base + dist + extraStop + waiting + errand;
  if (!isFinite(sum)) return undefined;
  return sum;
}

function computePayment(r: any): string | undefined {
  const cashMode = pickFirst(r, ["errand_cash_mode"]);
  if (cashMode === true || cashMode === "true" || cashMode === 1 || cashMode === "1") return "Cash";

  const pm = safeStr(pickFirst(r, ["payment_method", "payment_mode", "payment", "paid_via"]), "");
  const s = normalizeText(pm);
  if (s && s !== EMPTY) return s;

  return undefined;
}

function normalizeTrips(payload: any): TripSummary[] {
  const arr: any[] =
    (Array.isArray(payload) ? payload : null) ||
    (payload && Array.isArray(payload.data) ? payload.data : null) ||
    (payload && Array.isArray(payload.items) ? payload.items : null) ||
    (payload && Array.isArray(payload.rides) ? payload.rides : null) ||
    [];

  const out: TripSummary[] = arr.map((r) => {
    const ref = safeStr(pickFirst(r, ["booking_code", "code", "ref", "reference", "id"]), EMPTY);

    const pickup = safeStr(
      pickFirst(r, ["from_label", "pickup_address", "pickup", "from_address", "from", "origin"]),
      EMPTY
    );

    const dropoff = safeStr(
      pickFirst(r, ["to_label", "dropoff_address", "dropoff", "to_address", "to", "destination"]),
      EMPTY
    );

    const farePhp =
      safeNum(pickFirst(r, ["verified_fare"])) ??
      safeNum(pickFirst(r, ["passenger_fare_response"])) ??
      safeNum(pickFirst(r, ["proposed_fare"])) ??
      safeNum(pickFirst(r, ["fare", "total_fare", "total"])) ??
      computeFareFromComponents(r);

    const distanceKm = safeNum(pickFirst(r, ["distance_km", "distanceKm"]));

    const status = safeStr(pickFirst(r, ["status", "ride_status", "state"]), "pending");
    const payment = computePayment(r);

    const created = pickFirst(r, ["created_at", "requested_at", "started_at", "completed_at", "updated_at"]);
    const dateLabel = fmtDateLabel(created);

    const sortTs =
      parseTs(pickFirst(r, ["updated_at"])) ??
      parseTs(pickFirst(r, ["completed_at"])) ??
      parseTs(pickFirst(r, ["created_at"])) ??
      parseTs(created) ??
      0;

    return {
      ref: normalizeText(ref),
      dateLabel: normalizeText(dateLabel),
      service: "Ride",
      pickup: normalizeText(pickup),
      dropoff: normalizeText(dropoff),
      payment,
      farePhp,
      distanceKm,
      status: normalizeText(status),
      sortTs,
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

function loadFavs(): FavRoute[] {
  try {
    const raw = localStorage.getItem(FAV_KEY) || "";
    const j = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(j)) return [];
    return j
      .map((x: any) => ({
        id: normalizeText(x?.id),
        label: normalizeText(x?.label),
        from: normalizeText(x?.from),
        to: normalizeText(x?.to),
        createdAt: typeof x?.createdAt === "number" ? x.createdAt : Date.now(),
      }))
      .filter((x: FavRoute) => x.id && x.from !== EMPTY && x.to !== EMPTY);
  } catch {
    return [];
  }
}

function saveFavs(items: FavRoute[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(items));
  } catch {}
}

function makeFavId(from: string, to: string) {
  const f = normalizeText(from).toLowerCase();
  const t = normalizeText(to).toLowerCase();
  return "fav_" + btoa(unescape(encodeURIComponent(f + "||" + t))).replace(/=+$/g, "");
}

export default function HistoryPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("history");

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string>("");
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [selectedRef, setSelectedRef] = useState<string>("");

  const [toast, setToast] = useState<string>("");
  const [q, setQ] = useState<string>("");

  const [favs, setFavs] = useState<FavRoute[]>([]);

  useEffect(() => {
    // Load favorites once (UI-only)
    setFavs(loadFavs());
  }, []);

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setLoadErr("");
      try {
        const res = await fetch("/api/rides/list", { method: "GET", cache: "no-store" });
        const j = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = normalizeText(safeStr((j as any)?.error, "")) || ("HTTP " + res.status);
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

  const sortedTrips = useMemo(() => {
    const cp = [...trips];
    cp.sort((a, b) => (b.sortTs || 0) - (a.sortTs || 0));
    return cp;
  }, [trips]);

  const filteredTrips = useMemo(() => {
    const needle = normalizeText(q).toLowerCase();
    if (!needle || needle === EMPTY.toLowerCase()) return sortedTrips;
    return sortedTrips.filter((t) => normalizeText(t.ref).toLowerCase().includes(needle));
  }, [sortedTrips, q]);

  const selectedTrip = useMemo(() => {
    if (!selectedRef) return null;
    return filteredTrips.find((t) => t.ref === selectedRef) || trips.find((t) => t.ref === selectedRef) || null;
  }, [filteredTrips, trips, selectedRef]);

  function goRide(from: string, to: string) {
    const f = normalizeText(from);
    const t = normalizeText(to);
    const url = "/ride?from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t);
    router.push(url);
  }

  function addFavorite(label: string, from: string, to: string) {
    const f = normalizeText(from);
    const t = normalizeText(to);
    if (f === EMPTY || t === EMPTY) {
      setToast("Cannot save favorite with empty locations.");
      window.setTimeout(() => setToast(""), 1800);
      return;
    }

    const id = makeFavId(f, t);
    const item: FavRoute = { id, label: normalizeText(label), from: f, to: t, createdAt: Date.now() };

    setFavs((prev) => {
      const next = [item, ...prev.filter((x) => x.id !== id)];
      saveFavs(next);
      return next;
    });

    setToast("Saved favorite.");
    window.setTimeout(() => setToast(""), 1800);
  }

  function removeFavorite(id: string) {
    setFavs((prev) => {
      const next = prev.filter((x) => x.id !== id);
      saveFavs(next);
      return next;
    });
    setToast("Removed favorite.");
    window.setTimeout(() => setToast(""), 1800);
  }

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
    } catch {}

    const ok = await copyToClipboard(text);
    setToast(ok ? "Share not available - copied instead." : "Share/copy failed.");
    window.setTimeout(() => setToast(""), 1800);
  }

  function onDownload(trip: TripSummary) {
    const text = buildReceiptText(trip);
    const fn = "JRIDE_RECEIPT_" + normalizeText(trip.ref).replace(/[^A-Za-z0-9_-]/g, "_") + ".txt";
    const ok = downloadTextFile(fn, text);
    setToast(ok ? "Downloaded receipt." : "Download failed.");
    window.setTimeout(() => setToast(""), 1800);
  }

  function onPrint(trip: TripSummary) {
    const text = buildReceiptText(trip);
    const title = "JRide Receipt - " + normalizeText(trip.ref);
    const ok = printReceipt(title, text);
    setToast(ok ? "Print opened." : "Print popup blocked.");
    window.setTimeout(() => setToast(""), 1800);
  }

  function onSaveFavPreset(label: string) {
    if (!selectedTrip) return;
    addFavorite(label, selectedTrip.pickup, selectedTrip.dropoff);
  }

  function onSaveFavCustom() {
    if (!selectedTrip) return;
    const cur = "Trip " + normalizeText(selectedTrip.ref);
    const label = normalizeText(window.prompt("Favorite label (ex: Home, Work, Market):", cur) || cur);
    addFavorite(label, selectedTrip.pickup, selectedTrip.dropoff);
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

        {!loading && !loadErr && trips.length > 0 && (
          <div className="mt-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Trip Reference..."
              className="w-full max-w-md rounded-xl border border-black/10 bg-white px-3 py-2 text-sm shadow-sm"
            />
          </div>
        )}

        {loading && (
          <div className="mt-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm text-sm opacity-70">
            Loading trips...
          </div>
        )}

        {!loading && loadErr && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm text-sm text-red-700">
            Failed to load trips: {normalizeText(loadErr)}
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
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold mb-2">Trips</div>
                <div className="text-xs opacity-60 mt-1">Newest first</div>
              </div>

              {favs.length > 0 ? (
                <div className="mb-3 rounded-xl border border-black/10 bg-gray-50 p-3">
                  <div className="text-xs font-semibold mb-2">Favorites</div>
                  <div className="space-y-2">
                    {favs.slice(0, 6).map((f) => (
                      <div key={f.id} className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => goRide(f.from, f.to)}
                          className="flex-1 text-left rounded-xl border border-black/10 bg-white hover:bg-black/5 px-3 py-2 text-sm"
                        >
                          <div className="font-semibold">{normalizeText(f.label)}</div>
                          <div className="text-xs opacity-70 truncate">From: {normalizeText(f.from)}</div>
                          <div className="text-xs opacity-70 truncate">To: {normalizeText(f.to)}</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFavorite(f.id)}
                          className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-2 text-sm font-semibold"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] opacity-60 mt-2">Favorites are stored on this device only.</div>
                </div>
              ) : null}

              <div className="space-y-2">
                {filteredTrips.map((t) => {
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
                          <span className="text-xs opacity-60 font-normal">- {t.service}</span>
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

              <div className="mt-3 text-xs opacity-60">Data from /api/rides/list.</div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">Receipt</div>
                  <div className="text-xs opacity-60">Passenger-side receipt (wired)</div>
                </div>

                {selectedTrip ? (
                  <div className="flex flex-wrap gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => goRide(selectedTrip.pickup, selectedTrip.dropoff)}
                      className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 text-sm font-semibold"
                    >
                      Ride Again
                    </button>

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
                    <button
                      type="button"
                      onClick={() => onDownload(selectedTrip)}
                      className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-2 text-sm font-semibold"
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => onPrint(selectedTrip)}
                      className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-2 text-sm font-semibold"
                    >
                      Print
                    </button>
                  </div>
                ) : null}
              </div>

              {selectedTrip ? (
                <div className="mt-4">
                  <div className="rounded-2xl border border-black/10 bg-gray-50 p-4">
                    <div className="text-xs opacity-70">Trip Reference</div>
                    <div className="text-2xl font-extrabold tracking-tight">{normalizeText(selectedTrip.ref)}</div>
                    <div className="text-xs opacity-60 mt-1">{normalizeText(selectedTrip.dateLabel)}</div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="text-xs opacity-70 mr-1">Save favorite:</div>
                    <button
                      type="button"
                      onClick={() => onSaveFavPreset("Home")}
                      className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-2 text-sm font-semibold"
                    >
                      Home
                    </button>
                    <button
                      type="button"
                      onClick={() => onSaveFavPreset("Work")}
                      className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-2 text-sm font-semibold"
                    >
                      Work
                    </button>
                    <button
                      type="button"
                      onClick={() => onSaveFavPreset("Market")}
                      className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-2 text-sm font-semibold"
                    >
                      Market
                    </button>
                    <button
                      type="button"
                      onClick={() => onSaveFavCustom()}
                      className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-2 text-sm font-semibold"
                    >
                      Custom
                    </button>
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

                    {typeof selectedTrip.farePhp === "number" ? (
                      <div className="rounded-xl border border-black/10 p-3">
                        <div className="text-xs opacity-60">Fare</div>
                        <div className="font-semibold">{fareLabel(selectedTrip.farePhp)}</div>
                      </div>
                    ) : null}

                    {typeof selectedTrip.distanceKm === "number" ? (
                      <div className="rounded-xl border border-black/10 p-3">
                        <div className="text-xs opacity-60">Distance</div>
                        <div className="font-semibold">{km(selectedTrip.distanceKm)}</div>
                      </div>
                    ) : null}

                    {selectedTrip.payment ? (
                      <div className="rounded-xl border border-black/10 p-3">
                        <div className="text-xs opacity-60">Payment</div>
                        <div className="font-semibold">{normalizeText(selectedTrip.payment)}</div>
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-black/10 p-3">
                      <div className="text-xs opacity-60">Status</div>
                      <div className="font-semibold">{normalizeText(selectedTrip.status)}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-xs opacity-60">
                    P3A+P3B: Ride Again + Favorites stored locally (device only).
                  </div>

                  <div className="mt-2 text-xs opacity-60">
                    Note: Booking page prefill requires /ride to read ?from=&to= (next step once you upload app/ride/page.tsx).
                  </div>
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
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)

Ok "Wrote: $target"
Ok "Done."
