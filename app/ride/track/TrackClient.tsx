"use client";

import { useEffect, useState } from "react";

type Booking = {
  booking_code?: string;
  status?: string;
  driver_name?: string;
  proposed_fare?: number;
  convenience_fee?: number;
  pickup_distance_km?: number; // optional if backend adds later
};

function money(v?: number) {
  if (typeof v !== "number") return "--";
  return `PHP ${v}`;
}

export default function TrackClient({ code }: { code?: string }) {
  const [data, setData] = useState<Booking | null>(null);
  const [showFarePopup, setShowFarePopup] = useState(false);
  const [loading, setLoading] = useState(false);

  async function fetchBooking() {
    if (!code) return;

    const res = await fetch(
      `/api/public/passenger/booking?code=${encodeURIComponent(code)}&ts=${Date.now()}`,
      { cache: "no-store" }
    );

    const json = await res.json();

    if (json?.ok) {
      setData(json.booking ?? null);

      if (json.booking?.status === "fare_proposed") {
        setShowFarePopup(true);
      }
    }
  }

  async function sendFareResponse(action: "accepted" | "rejected") {
    if (!code) return;

    setLoading(true);

    try {
      await fetch(`/api/public/passenger/fare/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      setShowFarePopup(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!code) return;

    fetchBooking();
    const t = setInterval(fetchBooking, 3000);
    return () => clearInterval(t);
  }, [code]);

  const proposedFare = data?.proposed_fare;
  const fee = data?.convenience_fee ?? 15;
  const paxTotal =
    typeof proposedFare === "number" ? proposedFare + fee : undefined;

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Tracking</div>
        <div className="text-xs opacity-70">
          Code: {data?.booking_code ?? code ?? "--"}
        </div>
      </div>

      {data ? (
        <div className="rounded-xl border border-black/10 bg-white p-4 space-y-2">
          <div>Status: {data.status ?? "--"}</div>
          <div>Driver: {data.driver_name ?? "--"}</div>
        </div>
      ) : null}

      {showFarePopup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-lg">
            <div className="text-lg font-semibold">Fare Proposal</div>

            <div className="mt-2 text-sm space-y-2">
              <div>
                Driver fare:{" "}
                <span className="font-semibold">
                  {money(proposedFare)}
                </span>
              </div>

              <div>
                Platform fee:{" "}
                <span className="font-semibold">{money(fee)}</span>
              </div>

              <div className="text-base font-semibold">
                Total to pay: {money(paxTotal)}
              </div>

              {/* ✅ TRANSPARENCY WITHOUT FAKE MATH */}
              <div className="text-xs text-orange-600">
                Note: Final fare may vary depending on driver distance from pickup.
              </div>

              <div className="text-xs opacity-60">
                You will only be charged the confirmed total after acceptance.
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => sendFareResponse("accepted")}
                disabled={loading}
              >
                OK / Proceed
              </button>

              <button
                className="flex-1 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold"
                onClick={() => sendFareResponse("rejected")}
                disabled={loading}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}