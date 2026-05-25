// @ts-nocheck
"use client";

import { useState, useEffect } from "react";
import LiveTrips from "./LiveTrips";
import BookingMapClient from "./map/BookingMapClient";

export default function LiveTripsPage() {
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);

  useEffect(() => {
    async function fetchBookingDetails() {
      if (!selectedBookingId) return;

      try {
        const res = await fetch(`/api/admin/trips?id=${selectedBookingId}`, {
          cache: "no-store",
        });
        const json = await res.json();
        setSelectedBooking(json?.data ?? null);
      } catch (error) {
        console.error("Failed to fetch booking details", error);
      }
    }

    fetchBookingDetails();
  }, [selectedBookingId]);

  return (
    <div className="flex gap-4 p-4 w-full h-full">
      {/* LEFT: BOOKING LIST */}
      <div className="w-[460px] overflow-y-auto border-r pr-4">
        <LiveTrips
          selectedBookingId={selectedBookingId}
          setSelectedBookingId={setSelectedBookingId}
        />
      </div>

      {/* RIGHT: MAP */}
      <div className="flex-1 min-h-[600px]">
        <BookingMapClient
          bookingId={selectedBookingId}
          pickupLat={selectedBooking?.pickup_lat}
          pickupLng={selectedBooking?.pickup_lng}
          dropoffLat={selectedBooking?.dropoff_lat}
          dropoffLng={selectedBooking?.dropoff_lng}
          driverId={selectedBooking?.assigned_driver_id}
        />
      </div>
    </div>
  );
}
