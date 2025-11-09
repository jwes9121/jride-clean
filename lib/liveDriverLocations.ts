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
  // 1. Get current authenticated driver
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("upsertDriverLocation: no authenticated user", userError);
    return "no-user";
  }

  // 2. Upsert into driver_locations keyed by driver_id
  const { error } = await supabase.from("driver_locations").upsert(
    {
      driver_id: user.id, // must match auth.uid() for RLS
      lat,
      lng,
      status,
      town: town || null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "driver_id", // ensures 1 row per driver
    }
  );

  if (error) {
    console.error("upsertDriverLocation: upsert error", error);
    return "error";
  }

  return "ok";
}
