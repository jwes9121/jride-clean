"use client";

import { useMemo } from "react";

type TripEtaProps = {
  originLat: number | null;
  originLng: number | null;
  destLat: number | null;
  destLng: number | null;
  label?: string;
  /**
   * Average speed in km/h for ETA computation.
   * Default: 25 km/h (typical tricycle / mixed traffic).
   */
  avgSpeedKmh?: number;
  className?: string;
};

type EtaResult = {
  minutes: number | null;
  km: number | null;
};

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

/**
 * Simple Haversine distance + constant-speed ETA.
 * This avoids external API errors and is stable for dispatcher view.
 */
function computeEta(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  avgSpeedKmh: number
): EtaResult {
  const R = 6371; // km
  const dLat = toRad(destLat - originLat);
  const dLng = toRad(destLng - originLng);
  const lat1 = toRad(originLat);
  const lat2 = toRad(destLat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R * c;

  if (!isFinite(km) || Number.isNaN(km)) {
    return { minutes: null, km: null };
  }

  const hours = km / (avgSpeedKmh || 25);
  const minutes = Math.max(1, Math.round(hours * 60));

  return {
    minutes,
    km: parseFloat(km.toFixed(1)),
  };
}

export default function TripEta({
  originLat,
  originLng,
  destLat,
  destLng,
  label = "ETA",
  avgSpeedKmh = 25,
  className = "",
}: TripEtaProps) {
  const hasCoords =
    originLat !== null &&
    originLng !== null &&
    destLat !== null &&
    destLng !== null;

  const result: EtaResult = useMemo(() => {
    if (!hasCoords) {
      return { minutes: null, km: null };
    }
    return computeEta(
      originLat as number,
      originLng as number,
      destLat as number,
      destLng as number,
      avgSpeedKmh
    );
  }, [hasCoords, originLat, originLng, destLat, destLng, avgSpeedKmh]);

  if (!hasCoords) {
    return (
      <div
        className={`text-xs text-gray-500 italic ${className}`}
      >
        {label}: N/A
      </div>
    );
  }

  return (
    <div
      className={`text-xs text-gray-800 flex flex-col ${className}`}
    >
      <span className="font-semibold">
        {label}:{" "}
        {result.minutes !== null
          ? `${result.minutes} min`
          : "N/A"}
      </span>
      {result.km !== null && (
        <span className="text-[10px] text-gray-500">
          ~{result.km} km (approx)
        </span>
      )}
    </div>
  );
}
