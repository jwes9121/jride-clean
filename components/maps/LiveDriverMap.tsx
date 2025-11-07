"use client";

import MapboxMap from "@/components/components/MapboxMap";

type DriverFeature = {
  id: string | number;
  coordinates: [number, number]; // [lng, lat]
  color?: string;
};

/**
 * LiveDriverMap
 * - Currently uses static empty drivers list.
 * - Once Supabase realtime is wired, pass real driver coords here.
 */
export default function LiveDriverMap() {
  const drivers: DriverFeature[] = [];

  return (
    <div className="w-full h-full">
      <MapboxMap drivers={drivers} />
    </div>
  );
}