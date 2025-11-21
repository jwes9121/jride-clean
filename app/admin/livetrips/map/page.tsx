import BookingMapClient from "./BookingMapClient";

type PageProps = {
  searchParams?: { [key: string]: string | string[] | undefined };
};

export default function BookingMapPage({ searchParams }: PageProps) {
  const sp = searchParams ?? {};

  const bookingId =
    typeof sp.bookingId === "string" ? sp.bookingId : null;

  const pickupLat =
    typeof sp.pickupLat === "string" && sp.pickupLat !== ""
      ? Number(sp.pickupLat)
      : null;

  const pickupLng =
    typeof sp.pickupLng === "string" && sp.pickupLng !== ""
      ? Number(sp.pickupLng)
      : null;

  const dropoffLat =
    typeof sp.dropoffLat === "string" && sp.dropoffLat !== ""
      ? Number(sp.dropoffLat)
      : null;

  const dropoffLng =
    typeof sp.dropoffLng === "string" && sp.dropoffLng !== ""
      ? Number(sp.dropoffLng)
      : null;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Booking map</h1>
          <p className="text-sm text-gray-500">
            Live JRide map view for dispatch. Booking details can be wired
            here.
          </p>
        </div>

        <a
          href="/admin/livetrips"
          className="text-xs border rounded-full px-3 py-1 hover:bg-gray-50"
        >
          ← Back to Live Trips
        </a>
      </div>

      <BookingMapClient
        bookingId={bookingId}
        pickupLat={pickupLat}
        pickupLng={pickupLng}
        dropoffLat={dropoffLat}
        dropoffLng={dropoffLng}
      />
    </div>
  );
}
