"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type LiveTripStatus =
  | "pending"
  | "assigned"
  | "on_the_way"
  | "on_trip"
  | "completed"
  | "cancelled"
  | string;

export interface LiveTrip {
  id?: string | number;
  bookingCode?: string;
  status: LiveTripStatus;
  town?: string | null;

  pickupEtaSeconds?: number | null;
  dropoffEtaSeconds?: number | null;

  isProblem?: boolean;
  pickupRequestedAt?: string | null;
  assignedAt?: string | null;
  pickupAt?: string | null;
  lastUpdateAt?: string | null;
}

export interface ProblemTripAlertSoundsProps {
  trips: LiveTrip[];
  initialMuted?: boolean;
}

/**
 * Basic "problem" logic.
 */
function isProblemTrip(trip: LiveTrip): boolean {
  if (trip.isProblem) return true;

  const status = trip.status ?? "";
  const activeStatuses: LiveTripStatus[] = ["assigned", "on_the_way", "on_trip"];
  if (!activeStatuses.includes(status)) return false;

  const pickupEta = trip.pickupEtaSeconds ?? undefined;
  const dropoffEta = trip.dropoffEtaSeconds ?? undefined;

  const now = Date.now();
  const lastUpdateMs = trip.lastUpdateAt ? Date.parse(trip.lastUpdateAt) : undefined;
  const staleMs = lastUpdateMs ? now - lastUpdateMs : undefined;

  const PICKUP_ETA_WARNING = 5 * 60; // 5 min
  const DROPOFF_ETA_WARNING = 15 * 60; // 15 min
  const STALE_WARNING_MS = 3 * 60 * 1000; // 3 min

  const pickupTooLong =
    typeof pickupEta === "number" && pickupEta > PICKUP_ETA_WARNING;
  const dropoffTooLong =
    typeof dropoffEta === "number" && dropoffEta > DROPOFF_ETA_WARNING;
  const staleLocation =
    typeof staleMs === "number" && staleMs > STALE_WARNING_MS;

  return pickupTooLong || dropoffTooLong || staleLocation;
}

/**
 * Try to play JRide sound from two possible locations:
 *  - /sounds/problem-trip-alert.mp3
 *  - /problem-trip-alert.mp3
 */
async function playJrideSound(): Promise<void> {
  const sources = [
    "/sounds/problem-trip-alert.mp3",
    "/problem-trip-alert.mp3",
  ];

  for (const src of sources) {
    try {
      const audio = new Audio(src);
      await audio.play();
      return;
    } catch {
      // try next source
    }
  }
  // If we reach here, both failed - nothing more we can do.
}

export const ProblemTripAlertSounds: React.FC<ProblemTripAlertSoundsProps> = ({
  trips,
  initialMuted = false,
}) => {
  const [isMuted, setIsMuted] = useState<boolean>(initialMuted);
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);
  const previousProblemIdsRef = useRef<Set<string>>(new Set());

  const problemTrips = useMemo(
    () => trips.filter((t) => isProblemTrip(t)),
    [trips]
  );

  const problemTripIds = useMemo(() => {
    return new Set(
      problemTrips.map((t) => String(t.id ?? t.bookingCode ?? ""))
    );
  }, [problemTrips]);

  // 🔔 automatic alert when a new problem trip appears
  useEffect(() => {
    const prev = previousProblemIdsRef.current;
    let hasNew = false;

    for (const id of problemTripIds) {
      if (!prev.has(id)) {
        hasNew = true;
        break;
      }
    }

    if (hasNew && !isMuted && hasInteracted && problemTripIds.size > 0) {
      void playJrideSound();
    }

    previousProblemIdsRef.current = problemTripIds;
  }, [problemTripIds, isMuted, hasInteracted]);

  const handleMuteToggle = () => setIsMuted((m) => !m);

  const handleUserInteract = () => {
    if (!hasInteracted) setHasInteracted(true);
  };

  const handleTestAlert = () => {
    if (!hasInteracted) setHasInteracted(true);
    if (!isMuted) {
      void playJrideSound();
    }
  };

  const problemCount = problemTrips.length;

  if (!trips || trips.length === 0) {
    return (
      <div className="flex items-center justify-end gap-2 px-3 py-1 text-xs text-slate-500">
        <button
          type="button"
          onClick={handleTestAlert}
          className="rounded-full border px-2 py-1 text-[11px] hover:bg-slate-100"
        >
          Test alert
        </button>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px]">
          No active trips
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-end gap-2 border-b bg-slate-50 px-3 py-1 text-xs"
      onClick={handleUserInteract}
    >
      <div className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">
        <span
          className={
            problemCount > 0
              ? "inline-flex h-2 w-2 rounded-full bg-red-500"
              : "inline-flex h-2 w-2 rounded-full bg-slate-300"
          }
        />
        <span>Problem trips: {problemCount}</span>
      </div>

      <button
        type="button"
        onClick={handleMuteToggle}
        className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
      >
        <span
          className={
            isMuted
              ? "inline-flex h-2 w-2 rounded-full bg-slate-400"
              : "inline-flex h-2 w-2 rounded-full bg-emerald-500"
          }
        />
        <span>{isMuted ? "Muted" : "Sound On"}</span>
      </button>

      <button
        type="button"
        onClick={handleTestAlert}
        className="rounded-full border border-emerald-400 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50"
      >
        Test alert
      </button>

      {!hasInteracted && (
        <span className="text-[10px] text-slate-400">
          Tap once to unlock sound in your browser
        </span>
      )}
    </div>
  );
};

export default ProblemTripAlertSounds;
