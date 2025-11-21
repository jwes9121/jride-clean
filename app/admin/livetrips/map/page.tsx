import Link from "next/link";
import BookingMapClient from "./BookingMapClient";

type LiveTripMapPageProps = {
  searchParams?: {
    bookingId?: string;
  };
};

export default function LiveTripMapPage({ searchParams }: LiveTripMapPageProps) {
  const bookingId = searchParams?.bookingId ?? null;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Booking map</h1>
          <p className="text-sm text-gray-500">
            Live JRide map view for dispatch. Booking details can be wired here.
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

      <BookingMapClient bookingId={bookingId} />
    </div>
  );
}
