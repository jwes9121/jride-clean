"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
// If you already have a Booking type, keep this import; otherwise remove it and
// uncomment the inline fallback type below.
// import type { Booking } from "@/types/booking";

// Fallback type (uncomment if you don't have "@/types/booking")
// type Booking = { id: string; created_at?: string } & Record<string, any>;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type Props = {
  title?: string;
};

export default function BookingDashboard({ title = "Bookings" }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) setError(error.message);
    else setBookings(data ?? []);

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadBookings();

    // Realtime updates (cleanup must NOT return a Promise)
    const channel = supabase
      .channel("booking-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => { void loadBookings(); }
      )
      .subscribe();

    return () => { void channel.unsubscribe(); };
  }, [loadBookings]);

  return (
    <section className="p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {loading && <p className="mt-2 text-sm text-gray-500">Loading…</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {!loading && !error && (
        <p className="mt-2 text-sm text-gray-700">
          Showing {bookings.length} recent bookings.
        </p>
      )}
    </section>
  );
}
