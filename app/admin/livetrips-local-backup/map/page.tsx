"use client";

import BookingMapClient from "./BookingMapClient";
import { useSearchParams } from "next/navigation";

export default function Page() {
  const params = useSearchParams();
  const bookingId = params.get("bookingId");
  const pickupLat = params.get("pickupLat");
  const pickupLng = params.get("pickupLng");
  const dropoffLat = params.get("dropoffLat");
  const dropoffLng = params.get("dropoffLng");

  return (
    <BookingMapClient
      bookingId={bookingId}
      pickupLat={pickupLat ? parseFloat(pickupLat) : null}
      pickupLng={pickupLng ? parseFloat(pickupLng) : null}
      dropoffLat={dropoffLat ? parseFloat(dropoffLat) : null}
      dropoffLng={dropoffLng ? parseFloat(dropoffLng) : null}
    />
  );
}
