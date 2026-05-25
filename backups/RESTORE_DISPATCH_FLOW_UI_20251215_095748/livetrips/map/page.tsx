import { createClient } from "@supabase/supabase-js";
import BookingMapClient from "./BookingMapClient";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

type MapPageProps = {
  searchParams?: { [key: string]: string | string[] | undefined };
};

export default async function MapPage({ searchParams }: MapPageProps) {
  const bookingIdParam = searchParams?.bookingId;
  const bookingId =
    typeof bookingIdParam === "string" ? bookingIdParam : null;

  if (!bookingId) {
    return (
      <div className="w-full h-[600px] flex items-center justify-center text-sm text-gray-700">
        Missing bookingId in URL. Open this page via the dispatcher "View Map" link.
      </div>
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_code, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng"
    )
    .eq("id", bookingId)
    .single();

  if (error || !data) {
    console.error("BOOKING_MAP_DB_ERROR", error);
    return (
      <div className="w-full h-[600px] flex items-center justify-center text-sm text-red-700">
        Failed to load booking data for this map.
      </div>
    );
  }

  return (
    <div className="w-full h-[600px]">
      <BookingMapClient
        bookingId={data.id}
        bookingCode={data.booking_code ?? null}
        pickupLat={data.pickup_lat}
        pickupLng={data.pickup_lng}
        dropoffLat={data.dropoff_lat}
        dropoffLng={data.dropoff_lng}
      />
    </div>
  );
}
