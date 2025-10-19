// app/dispatch/BookingDashboard.tsx
"use client";

import { useEffect, useState } from "react";
// If your tsconfig has the path alias `@/*` (most Next.js setups do), use this:
import type { Booking } from "@/types/booking";
// If that alias isn't set, use a relative import instead:
// import type { Booking } from "../../types/booking";

type Props = {
  title?: string;
};

export default function BookingDashboard({ title = "Bookings" }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        setLoading(true);

        // TODO: Replace with your real data source / API call.
        // This stub just returns an empty list so the page compiles & builds.
        const data: Booking[] = [];

        if (!ignore) setBookings(data);
      } catch (e: any) {
        if (!ignore) setError(e?.message ?? "Failed to load bookings");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>

      {loading && <p>Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && (
        <ul className="divide-y divide-gray-200">
          {bookings.length === 0 && (
            <li className="py-2 text-gray-500">No bookings yet.</li>
          )}
          {bookings.map((b) => (
            <li key={b.id} className="py-2">
              <span className="font-medium">{b.passenger ?? "—"}</span>
              <span className="mx-2">•</span>
              <span>{b.status ?? "unknown"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
