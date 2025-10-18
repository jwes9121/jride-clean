"use client";

import { useEffect, useState } from "react";

type Props = { title?: string };

/** Minimal type so TS stops failing the build.
 *  Extend this later with the real fields you use.
 */
type Booking = {
  id: string;
  passenger?: string;
  pickup?: string;
  dropoff?: string;
  scheduledAt?: string | Date;
  status?: "pending" | "assigned" | "completed" | "cancelled" | string;
};

export default function BookingDashboard({ title = "Bookings" }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        // TODO: replace with your real fetch
        const data: Booking[] = [];
        if (mounted) setBookings(data);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load bookings");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section className="p-4">
      <h2 className="text-xl font-semibold mb-3">{title}</h2>
      {loading && <p>Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && !error && bookings.length === 0 && (
        <p className="text-neutral-600">No bookings yet.</p>
      )}
      <ul className="mt-2 space-y-2">
        {bookings.map((b) => (
          <li key={b.id} className="rounded-md border p-3">
            <div className="font-medium">{b.passenger ?? "Unknown passenger"}</div>
            <div className="text-sm text-neutral-600">
              {b.pickup ?? "—"} → {b.dropoff ?? "—"}
            </div>
            <div className="text-xs text-neutral-500">
              {typeof b.scheduledAt === "string" ? b.scheduledAt : b.scheduledAt?.toString() ?? "—"} ·{" "}
              {b.status ?? "pending"}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
