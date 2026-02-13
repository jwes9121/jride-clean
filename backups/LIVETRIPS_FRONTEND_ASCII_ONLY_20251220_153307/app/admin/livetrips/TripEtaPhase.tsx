"use client";

import React, { useEffect, useState } from "react";

type EtaUpdateDetail = {
  etaSeconds: number | null;
  updatedAt: string;
};

type TripEtaPhaseProps = {
  label?: string;
};

const formatEtaText = (etaSeconds: number | null): string => {
  if (etaSeconds === null) return "No route available";

  const totalMinutes = Math.round(etaSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const now = new Date();
  const arrival = new Date(now.getTime() + etaSeconds * 1000);

  const hh = arrival.getHours().toString().padStart(2, "0");
  const mm = arrival.getMinutes().toString().padStart(2, "0");

  const durationText =
    hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;

  return `${durationText} (arrive ~${hh}:${mm})`;
};

const TripEtaPhase: React.FC<TripEtaPhaseProps> = ({
  label = "Trip ETA",
}) => {
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(
    null
  );
  const [isCalculating, setIsCalculating] =
    useState<boolean>(true);

  // Listen to global ETA updates from the map
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<EtaUpdateDetail>;
      if (!custom.detail) return;

      setEtaSeconds(custom.detail.etaSeconds);
      setLastUpdatedAt(custom.detail.updatedAt);
      setIsCalculating(false);
    };

    if (typeof window !== "undefined") {
      window.addEventListener(
        "jride:eta-update",
        handler as EventListener
      );
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(
          "jride:eta-update",
          handler as EventListener
        );
      }
    };
  }, []);

  // Safety: if still "calculating" after 20s with no ETA, show "No route"
  useEffect(() => {
    if (!isCalculating) return;

    const timeout = setTimeout(() => {
      if (etaSeconds === null) {
        setIsCalculating(false);
      }
    }, 20000);

    return () => clearTimeout(timeout);
  }, [isCalculating, etaSeconds]);

  let mainText: string;

  if (isCalculating && etaSeconds === null) {
    mainText = "Calculating ETA…";
  } else {
    mainText = formatEtaText(etaSeconds);
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="font-semibold">{label}</div>
      <div className="text-base">{mainText}</div>
      {lastUpdatedAt && (
        <div className="text-xs text-gray-500">
          Updated{" "}
          {new Date(lastUpdatedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}
    </div>
  );
};

export default TripEtaPhase;
