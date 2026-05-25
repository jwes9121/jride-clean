"use client";

import { useEffect, ReactNode } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";

const supabase = createClientComponentClient();

// Adjust this type to match your "bookings" row if you want,
// but it's fine as "any" for now.
type Booking = any;

type LiveTripsProps = {
  children: ReactNode;
};

export default function LiveTrips({ children }: LiveTripsProps) {
  useEffect(() => {
    // Subscribe to realtime changes on bookings
    const channel = supabase
      .channel("realtime-livetrips")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
        },
        (payload) => {
          console.log("[realtime-livetrips] change:", payload);
          // You can later add a callback here to refresh SWR/React Query, etc.
        }
      )
      .subscribe((status) => {
        console.log("[realtime-livetrips] status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return <>{children}</>;
}
