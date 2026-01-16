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