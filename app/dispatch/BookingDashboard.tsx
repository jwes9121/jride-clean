"use client";

import { useEffect, useState } from "react";
import type { Booking } from "@/types/booking"; // <- import only

type Props = { title?: string };

export default function BookingDashboard({ title = "Bookings" }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoading(true);
        const data: Booking[] = []; // replace with real fetch later
        if (!ignore) setBookings(data);
      } catch (e: any) {
        if (!ignore) setError(e?.message ?? "Failed to load bookings");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, []);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {loading && <p>LoadingÃ¢â‚¬Â¦</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && !error && (
        <ul className="divide-y divide-gray-200">
          {bookings.length === 0 && <li className="py-2 text-gray-500">No bookings yet.</li>}
          {bookings.map(b => (
            <li key={b.id} className="py-2">
              <span className="font-medium">{b.passenger ?? "Ã¢â‚¬â€"}</span>
              <span className="mx-2">Ã¢â‚¬Â¢</span>
              <span>{b.status ?? "unknown"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


