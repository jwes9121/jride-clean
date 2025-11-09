"use client";

import { supabase } from "./supabaseDriverClient";

export type DriverStatus = "online" | "offline" | "on_trip";
export type UpsertResult = "ok" | "no-user" | "error";

let locationInterval: ReturnType<typeof setInterval> | null = null;

async function sendLocation(
  status: DriverStatus,
  town?: string
): Promise<UpsertResult> {
  if (typeof window === "undefined") {
    return "error";
  }

  if (!navigator.geolocation) {
    console.error("Geolocation not supported in this browser.");
    return "error";
  }

  return new Promise<UpsertResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          // Check authenticated driver
          const { data, error: userError } = await supabase.auth.getUser();

          if (userError || !data?.user) {
            console.warn(
              "upsertDriverLocation: no authenticated user (driver).",
              userError
            );
            resolve("no-user");
            return;
          }

          const driverId = data.user.id;

          const lat =
            status === "offline" ? 0 : pos.coords.latitude;
          const lng =
            status === "offline" ? 0 : pos.coords.longitude;

          const { error: upsertError } = await supabase
            .from("driver_locations")
            .upsert(
              {
                driver_id: driverId,
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

          if (upsertError) {
            console.error(
              "upsertDriverLocation: error during upsert",
              upsertError
            );
            resolve("error");
            return;
          }

          resolve("ok");
        } catch (err) {
          console.error("upsertDriverLocation: unexpected error", err);
          resolve("error");
        }
      },
      (geoErr) => {
        console.error("Geolocation error", geoErr);
        resolve("error");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
      }
    );
  });
}

export async function startDriverTracking(
  town?: string
): Promise<UpsertResult> {
  // First send; if that fails, do not start interval.
  const first = await sendLocation("online", town);

  if (first !== "ok") {
    return first;
  }

  if (!locationInterval) {
    locationInterval = setInterval(() => {
      // fire and forget; errors are logged inside
      void sendLocation("online", town);
    }, 10000);
  }

  return "ok";
}

export async function stopDriverTracking(
  town?: string
): Promise<UpsertResult> {
  if (locationInterval) {
    clearInterval(locationInterval);
    locationInterval = null;
  }

  // Mark offline in DB (best-effort)
  const res = await sendLocation("offline", town);
  return res === "ok" ? "ok" : res;
}
