// @ts-nocheck
import BookingMapClient from "./map/BookingMapClient";

export default function LiveTripsPage() {
  return (
    <div className="flex w-full h-screen overflow-hidden">
      {/* LEFT: placeholder / future trips list */}
      <div className="w-[40%] min-w-[420px] max-h-screen overflow-y-auto border-r border-gray-200 p-4">
        <h1 className="text-lg font-semibold mb-2">Live Trips (Dispatch)</h1>
        <p className="text-sm text-gray-600">
          Local debug layout – booking list panel not wired yet. Focus here is
          confirming Mapbox map and layout.
        </p>
      </div>

      {/* RIGHT: Map */}
      <div className="flex-1 p-4">
        <BookingMapClient
          bookingId={null}
          pickupLat={null}
          pickupLng={null}
          dropoffLat={null}
          dropoffLng={null}
        />
      </div>
    </div>
  );
}
