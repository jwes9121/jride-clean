"use client";

import React, { useEffect } from "react";
import type { LiveTrip } from "./ProblemTripAlertSounds";

export interface StuckTripWatcherProps {
  trips: LiveTrip[];
  onStuckChange?: (ids: string[]) => void;
}

/**
 * Stuck logic (Phase 1):
 * - Status is on_the_way or on_trip
 * - AND:
 *    - pickup ETA > 10 min  (for on_the_way)
 *    - OR dropoff ETA > 30 min (for on_trip)
 *    - OR lastUpdateAt is older than 5 minutes
 */
function isTripStuck(trip: LiveTrip): boolean {
  const status = trip.status ?? "";
  const activeStatuses = ["on_the_way", "on_trip"];

  if (!activeStatuses.includes(status)) return false;

  const pickupEta = trip.pickupEtaSeconds ?? undefined;
  const dropoffEta = trip.dropoffEtaSeconds ?? undefined;

  const now = Date.now();
  const lastUpdateMs = trip.lastUpdateAt ? Date.parse(trip.lastUpdateAt) : undefined;
  const staleMs = lastUpdateMs ? now - lastUpdateMs : undefined;

  const PICKUP_ETA_STUCK = 10 * 60; // 10 minutes
  const DROPOFF_ETA_STUCK = 30 * 60; // 30 minutes
  const STALE_MS = 5 * 60 * 1000; // 5 minutes

  const pickupTooLong =
    typeof pickupEta === "number" && pickupEta > PICKUP_ETA_STUCK;

  const dropoffTooLong =
    typeof dropoffEta === "number" && dropoffEta > DROPOFF_ETA_STUCK;

  const veryStale =
    typeof staleMs === "number" && staleMs > STALE_MS;

  return pickupTooLong || dropoffTooLong || veryStale;
}

export const StuckTripWatcher: React.FC<StuckTripWatcherProps> = ({
  trips,
  onStuckChange,
}) => {
  useEffect(() => {
    if (!trips || trips.length === 0) {
      onStuckChange?.([]);
      return;
    }

    const stuckIds = trips
      .filter((t) => isTripStuck(t))
      .map((t) => String(t.id ?? t.bookingCode ?? ""));

    onStuckChange?.(stuckIds);
  }, [trips, onStuckChange]);

  // No UI – purely background watcher
  return null;
};

export default StuckTripWatcher;
