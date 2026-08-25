import { supabaseAdmin } from "@/lib/supabaseAdmin";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function errandFeatureEnabled(): boolean {
  const raw = text(process.env.JRIDE_ERRAND_BOOKING_ENABLED).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function loadErrandBundleByBookingId(bookingId: string) {
  const admin = supabaseAdmin();

  const bookingRes = await admin
    .from("bookings")
    .select(
      "id,booking_code,passenger_name,created_by_user_id,service_type,status,town,from_label,to_label,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,driver_id,assigned_driver_id,driver_to_pickup_km,pickup_distance_fee,base_fee,distance_fare,waiting_minutes,waiting_fee,stop_count,extra_stop_fee,elevation_surcharge,heavy_load_fee,total_errand_fare,company_cut,driver_payout,created_at,updated_at"
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingRes.error || !bookingRes.data) {
    return {
      ok: false as const,
      error: bookingRes.error?.message || "BOOKING_NOT_FOUND",
    };
  }

  if (text((bookingRes.data as any).service_type).toLowerCase() !== "errand") {
    return { ok: false as const, error: "NOT_ERRAND_BOOKING" };
  }

  const [jobRes, stopsRes] = await Promise.all([
    admin.from("errand_jobs").select("*").eq("booking_id", bookingId).maybeSingle(),
    admin
      .from("errand_stops")
      .select("*")
      .eq("booking_id", bookingId)
      .order("sequence", { ascending: true }),
  ]);

  if (jobRes.error || !jobRes.data) {
    return {
      ok: false as const,
      error: jobRes.error?.message || "ERRAND_JOB_NOT_FOUND",
    };
  }

  if (stopsRes.error) {
    return { ok: false as const, error: stopsRes.error.message };
  }

  return {
    ok: true as const,
    booking: bookingRes.data,
    job: jobRes.data,
    stops: Array.isArray(stopsRes.data) ? stopsRes.data : [],
  };
}

export function errandFareBreakdown(booking: any) {
  return {
    base_fare: Number(booking?.base_fee || 0),
    pickup_distance_fee: Number(booking?.pickup_distance_fee || 0),
    distance_fare: Number(booking?.distance_fare || 0),
    extra_stop_fee: Number(booking?.extra_stop_fee || 0),
    waiting_fee: Number(booking?.waiting_fee || 0),
    elevation_surcharge: Number(booking?.elevation_surcharge || 0),
    heavy_load_fee: Number(booking?.heavy_load_fee || 0),
    total_errand_fare: Number(booking?.total_errand_fare || 0),
    company_cut: Number(booking?.company_cut || 0),
    driver_payout: Number(booking?.driver_payout || 0),
  };
}
