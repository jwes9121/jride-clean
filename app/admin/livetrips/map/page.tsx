// app/admin/livetrips/map/page.tsx

import dynamic from "next/dynamic";

const BookingMapClient = dynamic(() => import("./BookingMapClient"), {
  ssr: false,
});

type MapPageSearchParams = {
  bookingId?: string;
  pickupLat?: string;
  pickupLng?: string;
  dropoffLat?: string;
  dropoffLng?: string;
};

type MapPageProps = {
  searchParams?: MapPageSearchParams;
};

function toNumberOrNull(value?: string): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function MapPage({ searchParams }: MapPageProps) {
  const bookingId = searchParams?.bookingId ?? null;

  const pickupLat = toNumberOrNull(searchParams?.pickupLat);
  const pickupLng = toNumberOrNull(searchParams?.pickupLng);
  const dropoffLat = toNumberOrNull(searchParams?.dropoffLat);
  const dropoffLng = toNumberOrNull(searchParams?.dropoffLng);

  return (
    <div className="p-4 w-full h-[600px]">
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
