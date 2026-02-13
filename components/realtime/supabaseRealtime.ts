"use client";

import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { DriverLocation, Ride } from "@/types";

type EventType = "INSERT" | "UPDATE" | "DELETE";
type Handler<T> = (e: { type: EventType; old?: T | null; new?: T | null }) => void;

/** Subscribe to driver_locations realtime changes (SYNC cleanup). */
export function subscribeDriverLocations(onEvent: Handler<DriverLocation>) {
  const supabase = createClient();
  const channel = supabase
    .channel("driver_locations_realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "driver_locations" },
      (payload: RealtimePostgresChangesPayload<DriverLocation> & { eventType: EventType }) => {
        onEvent({
          type: payload.eventType,
          old: (payload as any).old ?? null,
          new: (payload as any).new ?? null,
        });
      }
    )
    .subscribe();

  // return SYNC cleanup (React useEffect requirement)
  return () => { void channel.unsubscribe(); };
}

/** Subscribe to rides realtime changes (SYNC cleanup). */
export function subscribeRides(onEvent: Handler<Ride>) {
  const supabase = createClient();
  const channel = supabase
    .channel("rides_realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rides" },
      (payload: any & { eventType: EventType }) => {
        onEvent({
          type: payload.eventType,
          old: payload.old ?? null,
          new: payload.new ?? null,
        });
      }
    )
    .subscribe();

  return () => { void channel.unsubscribe(); };
}

/** One-shot fetch for initial driver locations. */
export async function fetchInitialDriverLocations(): Promise<DriverLocation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("driver_locations")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data ?? []) as DriverLocation[];
}

/** One-shot fetch for current active rides. Adjust statuses to your schema. */
export async function fetchActiveRides(): Promise<Ride[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .in("status", [
      "pending",
      "assigned",
      "accepted",
      "enroute",
      "arrived",
      "picked_up",
    ])
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data ?? []) as Ride[];
}
