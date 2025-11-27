"use client";
import { useRouter } from "next/navigation";

export function ViewMapButton({ booking }: { booking: any }) {
  const router = useRouter();
  return (
    <button
      onClick={() =>
        router.push(
          `/admin/livetrips?bookingId=${booking.id}&pickupLat=${booking.pickup_lat}&pickupLng=${booking.pickup_lng}&dropoffLat=${booking.dropoff_lat}&dropoffLng=${booking.dropoff_lng}`
        )
      }
      className="btn btn-sm"
    >
      View map
    </button>
  );
}
