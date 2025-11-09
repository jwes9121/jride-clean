"use client";

import { supabase } from "./supabaseDriverClient";

export type DriverStatus = "online" | "offline" | "on_trip";

type UpsertParams = {
  lat: number;
  lng: number;
  status: DriverStatus;
  town?: string;
};

export async function upsertDriverLocation({
  lat,
  lng,
  status,
  town,
}: UpsertParams): Promise<"ok" | "no-user" | "error"> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("upsertDriverLocation: no authenticated user", userError);
    return "no-user";
  }

  const { error } = await supabase.from("driver_locations").upsert(
    {
      driver_id: user.id,
      lat,
      lng,
      status,
      town: town || null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "driver_id",
    }
  );

  if (error) {
    console.error("upsertDriverLocation: upsert error", error);
    return "error";
  }

  return "ok";
}

let locationInterval: ReturnType<typeof setInterval> | null = null;

export function startDriverTracking(town?: string) {
  if (locationInterval) return;

  const sendLocation = () => {
    if (!navigator.geolocation) {
      console.error("Geolocation not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        await upsertDriverLocation({
          lat: latitude,
          lng: longitude,
          status: "online",
          town,
        });
      },
      (err) => {
        console.error("Geolocation error", err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
      }
    );
  };

  sendLocation();
  locationInterval = setInterval(sendLocation, 10000);
}

export function stopDriverTracking(town?: string) {
  if (locationInterval) {
    clearInterval(locationInterval);
    locationInterval = null;
  }

  upsertDriverLocation({
    lat: 0,
    lng: 0,
    status: "offline",
    town,
  }).catch((e) => console.error(e));
}
