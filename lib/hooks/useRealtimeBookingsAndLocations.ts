"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

type AnyRow = Record<string, any>;

type Options = {
  onBookingChange?: (row: AnyRow) => void;
  onDriverLocationChange?: (row: AnyRow) => void;
};

export function useRealtimeBookingsAndLocations(options: Options) {
  const { onBookingChange, onDriverLocationChange } = options;

  useEffect(() => {
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
          console.log("Realtime booking:", payload);
          if (onBookingChange && payload.new) {
            onBookingChange(payload.new);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_locations",
        },
        (payload) => {
          console.log("Realtime driver_location:", payload);
          if (onDriverLocationChange && payload.new) {
            onDriverLocationChange(payload.new);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onBookingChange, onDriverLocationChange]);
}
