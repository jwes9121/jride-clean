"use client";

import { createClient } from "@/lib/supabase/client";
import type { DriverLocation, Ride, RealtimeEvent } from "@/types";

type Handler<T> = (e: RealtimeEvent<T>) => void;

const supabase = createClient();

export function subscribeDriverLocations(onEvent: Handler<DriverLocation>) {
  const channel = supabase
    .channel("driver_locations_realtime")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "driver_locations" },
      (payload) => {
        onEvent({
          type: payload.eventType as any,
          new: payload.new as any,
          old: payload.old as any,
        });
      })
    .subscribe();

  return () => supabase.removeChannel(channel);
}

export function subscribeRides(onEvent: Handler<Ride>) {
  const channel = supabase
    .channel("rides_realtime")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "rides" },
      (payload) => {
        onEvent({
          type: payload.eventType as any,
          new: payload.new as any,
          old: payload.old as any,
        });
      })
    .subscribe();

  return () => supabase.removeChannel(channel);
}

export async function fetchInitialDriverLocations(): Promise<DriverLocation[]> {
  const { data, error } = await supabase
    .from("driver_locations_view")
    .select("id,name:driver_name,lat:latitude,lng:longitude,status,town,updated_at");
  if (error) return [];
  return (data as any[]).map((r) => ({
    id: r.id,
    name: r.name ?? "Driver",
    lat: r.lat, lng: r.lng,
    status: (r.status ?? "offline") as any,
    town: r.town ?? null,
    updated_at: r.updated_at ?? null,
  }));
}

export async function fetchActiveRides(): Promise<Ride[]> {
  const { data, error } = await supabase
    .from("rides")
    .select("id,status,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,town,created_at,driver_id")
    .in("status", ["pending","searching","assigned","accepted","picked_up"])
    .order("created_at", { ascending: false });
  if (error) return [];
  return data as Ride[];
}
