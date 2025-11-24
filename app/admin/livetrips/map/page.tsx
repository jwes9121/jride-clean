import { BookingMap } from "@/components/maps/BookingMap";

type PageProps = {
  searchParams: {
    bookingId?: string;
    pickupLat?: string;
    pickupLng?: string;
    dropoffLat?: string;
    dropoffLng?: string;
  };
};

export default function BookingMapPage({ searchParams }: PageProps) {
  const { bookingId, pickupLat, pickupLng, dropoffLat, dropoffLng } =
    searchParams;

  const pickupLatNum = pickupLat ? parseFloat(pickupLat) : NaN;
  const pickupLngNum = pickupLng ? parseFloat(pickupLng) : NaN;
  const dropoffLatNum = dropoffLat ? parseFloat(dropoffLat) : NaN;
  const dropoffLngNum = dropoffLng ? parseFloat(dropoffLng) : NaN;

  const hasPickup =
    !Number.isNaN(pickupLatNum) && !Number.isNaN(pickupLngNum);

  return (
    <div className="p-4 space-y-2">
      <h1 className="text-xl font-semibold">Booking map</h1>
      <p className="text-sm text-gray-600">
        Live JRide map view for dispatch. Booking details can be wired here.
      </p>

      <p className="text-xs text-gray-500">
        Booking: <span className="font-mono">{bookingId ?? "unknown"}</span> ·
        pickup {pickupLat ?? "?"}, {pickupLng ?? "?"} · dropoff{" "}
        {dropoffLat ?? "?"}, {dropoffLng ?? "?"}
      </p>

      {!hasPickup ? (
        <p className="mt-4 text-sm text-red-600">
          Missing or invalid pickup coordinates – cannot render map.
        </p>
      ) : (
        <BookingMap
          pickupLat={pickupLatNum}
          pickupLng={pickupLngNum}
          dropoffLat={dropoffLatNum}
          dropoffLng={dropoffLngNum}
        />
      )}
    </div>
  );
}
