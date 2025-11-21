"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function LiveTripMapPage() {
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("bookingId");

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Booking map</h1>
          <p className="text-sm text-gray-500">
            Temporary map view for dispatch. Booking details will be wired here.
          </p>
        </div>

        <Link
          href="/admin/livetrips"
          className="text-xs border rounded-full px-3 py-1 hover:bg-gray-50"
        >
          ← Back to Live Trips
        </Link>
      </div>

      <div className="text-sm text-gray-600">
        <div>
          <span className="font-semibold">Booking ID:</span>{" "}
          <span className="font-mono text-xs">
            {bookingId ?? "Unknown booking"}
          </span>
        </div>
      </div>

      <div className="border border-dashed rounded-xl h-[480px] flex items-center justify-center bg-gray-50">
        <span className="text-sm text-gray-500">
          Map placeholder — this is where the JRide / Mapbox view will go.
        </span>
      </div>
    </div>
  );
}
