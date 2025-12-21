import { createClient } from "@supabase/supabase-js";

export type LatLng = {
  lat: number;
  lng: number;
};

export type LiveTrip = {
  id: number;
  booking_code: string;
  passenger_name: string | null;
  zone: string | null;
  status: string;
  pickup: LatLng | null;
  dropoff: LatLng | null;
};

function getServerSupabaseClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing SUPABASE URL / ANON KEY env vars (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL; SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)."
    );
  }

  return createClient(url, anonKey);
}

function unwrapRpcResult(raw: any): any[] {
  if (!raw) return [];

  // Case 1: already an array
  if (Array.isArray(raw)) {
    return raw;
  }

  // Case 2: object with known keys
  if (Array.isArray((raw as any).active_bookings)) {
    return (raw as any).active_bookings;
  }

  if (Array.isArray((raw as any).bookings)) {
    return (raw as any).bookings;
  }

  if (
    Array.isArray((raw as any).admin_get_live_trips_page_data)
  ) {
    return (raw as any).admin_get_live_trips_page_data;
  }

  // Case 3: object with a single array value
  const values = Object.values(raw);
  if (values.length === 1 && Array.isArray(values[0])) {
    return values[0] as any[];
  }

  console.warn("Unexpected RPC result shape for admin_get_live_trips_page_data:", raw);
  return [];
}

export async function getLiveTrips(): Promise<LiveTrip[]> {
  const supabase = getServerSupabaseClient();

  const { data, error } = await supabase.rpc(
    "admin_get_live_trips_page_data"
  );

  if (error) {
    console.error("admin_get_live_trips_page_data error", error);
    throw error;
  }

  const rows = unwrapRpcResult(data);

  if (!rows.length) {
    return [];
  }

  return rows.map((b: any) => {
    const pickup =
      b.pickup_lat != null && b.pickup_lng != null
        ? { lat: Number(b.pickup_lat), lng: Number(b.pickup_lng) }
        : null;

    const dropoff =
      b.dropoff_lat != null && b.dropoff_lng != null
        ? { lat: Number(b.dropoff_lat), lng: Number(b.dropoff_lng) }
        : null;

    return {
      id: Number(b.id),
      booking_code: String(b.booking_code),
      passenger_name: b.passenger_name ?? null,
      zone: (b.zone ?? b.town ?? null) as string | null,
      status: String(b.status),
      pickup,
      dropoff,
    };
  });
}
