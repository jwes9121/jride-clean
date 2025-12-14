"use client";

type TripEtaPhaseProps = {
  bookingStatus: string | null;
  driverLat: number | null;
  driverLng: number | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
};

export default function TripEtaPhase({
  bookingStatus,
  driverLat,
  driverLng,
  pickupLat,
  pickupLng,
  dropoffLat,
  dropoffLng,
}: TripEtaPhaseProps) {
  return (
    <div style={{ marginTop: "4px", fontSize: "0.85rem" }}>
      ETA: N/A
    </div>
  );
}
