import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function updateDriverLocation(
  driverId: string,
  lat: number,
  lng: number,
  status: string = "online"
) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. " +
        "Configure them in .env.local and in Vercel project settings."
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const { error } = await supabase.rpc("log_live_driver_location", {
    p_driver_id: driverId,
    p_lat: lat,
    p_lng: lng,
    p_status: status
  });

  if (error) {
    console.error("[JRide] Failed to log live driver location", {
      driverId,
      lat,
      lng,
      status,
      error
    });
    throw error;
  }
}
