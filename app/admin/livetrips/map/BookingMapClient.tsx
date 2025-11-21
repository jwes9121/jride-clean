"use client";

import dynamic from "next/dynamic";

type Props = {
  bookingId: string | null;
};

// Use dynamic import so Mapbox / window stuff only runs in the browser
const LiveDriverMap = dynamic(
  () => import("@/components/maps/LiveDriverMap"),
  { ssr: false }
);

export default function BookingMapClient({ bookingId }: Props) {
  return (
    <div className="relative h-[480px] rounded-xl overflow-hidden border border-gray-200">
      <div className="absolute z-10 m-2 rounded bg-white/80 px-2 py-1 text-[10px] font-mono">
        Booking: {bookingId ?? "unknown"}
      </div>
      <LiveDriverMap />
    </div>
  );
}
