"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { computeTricycleFare } from "@/lib/fare";

type CreateBookingResponse = {
  id?: string;
  [key: string]: any;
};

export default function ConfirmFarePage() {
  const params = useSearchParams();
  const router = useRouter();
  const passengers = Number(params.get("count") ?? 1);

  const fare = useMemo(() => computeTricycleFare(passengers), [passengers]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setErr(null);
    try {
      // Call your existing API route (already present in your build list)
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Minimal payload – extend later with pickup/dropoff, notes, etc.
        body: JSON.stringify({
          mode: "tricycle",
          passengers,
          fare,
          source: "web",     // useful for future analytics
        }),
      });

      // If your backend returns JSON with an id, use it. Otherwise, fallback.
      let bookingId: string | undefined;
      try {
        const data: CreateBookingResponse = await res.json();
        bookingId = data?.id;
      } catch (_) {}

      if (!res.ok) {
        throw new Error(`Failed to create booking (${res.status})`);
      }

      // Route to success page, include total + id for display
      const idParam = bookingId ? `&id=${encodeURIComponent(bookingId)}` : "";
      router.replace(`/request/success?total=${fare.total}&count=${passengers}${idParam}`);
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong while creating the booking.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-3">Trip Summary</h1>
      <ul className="mb-4 text-sm">
        <li>• Base Fare (LLGU Matrix): ₱{fare.base}</li>
        <li>• Additional Passengers (₱20 each): ₱{fare.addPassengers}</li>
        <li>• Convenience Fee: ₱{fare.convenienceFee}</li>
      </ul>

      <h2 className="text-lg font-bold mb-4">Total Fare: ₱{fare.total}</h2>
      <p className="text-xs text-yellow-700 mb-4">
        ⚠️ Please confirm your booking. The total amount of ₱{fare.total} is payable directly to the driver upon arrival.
      </p>

      {err && <p className="text-red-600 text-sm mb-3">Error: {err}</p>}

      <div className="flex gap-3">
        <button
          onClick={() => history.back()}
          className="px-4 py-2 rounded border"
          disabled={submitting}
        >
          ← Back
        </button>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? "Confirming..." : "Confirm Booking →"}
        </button>
      </div>
    </main>
  );
}
