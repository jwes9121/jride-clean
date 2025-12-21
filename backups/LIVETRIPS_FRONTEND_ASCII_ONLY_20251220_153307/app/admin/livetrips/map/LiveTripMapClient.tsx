"use client";

// Wrapper that adapts whatever LiveTripsClient sends
// into the `booking` object expected by BookingMapClient.

import BookingMapClient, { Booking } from "../BookingMapClient";

type LiveTripMapClientProps = any;

function pickLat(obj: any): number | null {
  if (!obj) return null;
  if (typeof obj.lat === "number") return obj.lat;
  if (typeof obj.latitude === "number") return obj.latitude;
  if (typeof obj.pickup_lat === "number") return obj.pickup_lat;
  return null;
}

function pickLng(obj: any): number | null {
  if (!obj) return null;
  if (typeof obj.lng === "number") return obj.lng;
  if (typeof obj.lon === "number") return obj.lon;
  if (typeof obj.longitude === "number") return obj.longitude;
  if (typeof obj.pickup_lng === "number") return obj.pickup_lng;
  return null;
}

function pickLabel(obj: any): string | null {
  if (!obj) return null;
  if (typeof obj.label === "string") return obj.label;
  if (typeof obj.name === "string") return obj.name;
  if (typeof obj.title === "string") return obj.title;
  return null;
}

export default function LiveTripMapClient(props: LiveTripMapClientProps) {
  console.log("[LiveTripMapClient] props received:", props);

  let booking: Booking | null = null;

  // CASE 1: Parent already passes a full booking row
  if (props?.booking && typeof props.booking.pickup_lat === "number") {
    booking = props.booking as Booking;
  } else if (typeof props?.pickup_lat === "number" && typeof props?.dropoff_lat === "number") {
    // CASE 2: Parent passes flat fields on props
    booking = props as Booking;
  } else if (props?.trip && typeof props.trip.pickup_lat === "number") {
    // CASE 3: Parent sends { trip: bookingRow }
    booking = props.trip as Booking;
  } else if (props?.selected && typeof props.selected.pickup_lat === "number") {
    // CASE 4: Parent sends { selected: bookingRow }
    booking = props.selected as Booking;
  } else if (props?.pickup && props?.dropoff) {
    // CASE 5: Parent sends { pickup: {...}, dropoff: {...} }
    const pickupLat = pickLat(props.pickup);
    const pickupLng = pickLng(props.pickup);
    const dropoffLat = pickLat(props.dropoff);
    const dropoffLng = pickLng(props.dropoff);

    if (
      typeof pickupLat === "number" &&
      typeof pickupLng === "number" &&
      typeof dropoffLat === "number" &&
      typeof dropoffLng === "number"
    ) {
      booking = {
        id: props.bookingId ?? props.id ?? "live-trip",
        booking_code: props.bookingCode ?? props.code ?? "LIVE-TRIP",
        passenger_name: props.passenger ?? null,
        pickup_label: pickLabel(props.pickup),
        dropoff_label: pickLabel(props.dropoff),
        zone: props.zone ?? null,
        town: props.town ?? null,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_lat: dropoffLat,
        dropoff_lng: dropoffLng,
        status: props.status ?? props.tripStatus ?? "on_trip",
        driver_id: props.driver_id ?? null,
        driver_lat: pickLat(props.driver),
        driver_lng: pickLng(props.driver),
        driver_status: props.driver_status ?? null,
        driver_town: props.driver_town ?? null,
      };
    }
  }

  // BookingMapClient is fully guarded; if booking is null/undefined
  // it will just show "No live trip selected" and NEVER crash.
  return <BookingMapClient booking={booking ?? undefined} />;
}
