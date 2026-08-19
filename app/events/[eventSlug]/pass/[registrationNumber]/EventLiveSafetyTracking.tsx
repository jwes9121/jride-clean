"use client";

import * as React from "react";
import EventParticipantLiveMap from "./EventParticipantLiveMap";

type TrackingStatusResponse = {
  success: boolean;
  eventStatus?: string;
  attendeeStatus?: string;
  trackingAvailable?: boolean;
  availabilityReason?: string;
  sharingActive?: boolean;
  sharingStartedAt?: string | null;
  lastUpdatedAt?: string | null;
  lastAccuracyM?: number | null;
  message?: string;
};

type CurrentPosition = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  updatedAt: string;
};

type Props = {
  eventSlug: string;
  eventName: string;
  registrationNumber: string;
  qrToken: string;
};

function storageKey(eventSlug: string, registrationNumber: string) {
  return `jride_event_live_safety_choice_${eventSlug}_${registrationNumber}`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "";

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export default function EventLiveSafetyTracking({
  eventSlug,
  eventName,
  registrationNumber,
  qrToken,
}: Props) {
  const [status, setStatus] =
    React.useState<TrackingStatusResponse | null>(null);
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [tracking, setTracking] = React.useState(false);
  const [error, setError] = React.useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = React.useState<string | null>(null);
  const [lastAccuracyM, setLastAccuracyM] = React.useState<number | null>(null);
  const [currentPosition, setCurrentPosition] =
    React.useState<CurrentPosition | null>(null);

  const watchIdRef = React.useRef<number | null>(null);
  const wakeLockRef = React.useRef<any>(null);
  const lastSentAtRef = React.useRef(0);
  const trackingRef = React.useRef(false);

  React.useEffect(() => {
    trackingRef.current = tracking;
  }, [tracking]);

  const statusUrl = React.useMemo(
    () =>
      `/api/events/${encodeURIComponent(
        eventSlug
      )}/live-location?registrationNumber=${encodeURIComponent(
        registrationNumber
      )}&token=${encodeURIComponent(qrToken)}`,
    [eventSlug, registrationNumber, qrToken]
  );

  async function loadStatus() {
    try {
      const response = await fetch(statusUrl, {
        cache: "no-store",
      });

      const data = (await response.json()) as TrackingStatusResponse;

      if (!response.ok || !data.success) {
        return null;
      }

      setStatus(data);

      if (data.lastUpdatedAt) {
        setLastUpdatedAt(data.lastUpdatedAt);
      }

      if (typeof data.lastAccuracyM === "number") {
        setLastAccuracyM(data.lastAccuracyM);
      }

      if (data.trackingAvailable && !trackingRef.current) {
        let choice = "";

        try {
          choice = window.localStorage.getItem(
            storageKey(eventSlug, registrationNumber)
          ) || "";
        } catch {}

        if (choice !== "dismissed") {
          setPromptOpen(true);
        }
      }

      if (!data.trackingAvailable && trackingRef.current) {
        stopLocalTracking();
        setTracking(false);
      }

      return data;
    } catch {
      return null;
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function pollStatus() {
      const nextStatus = await loadStatus();

      if (cancelled) return;

      const waitingForAttendance =
        nextStatus?.eventStatus === "live" &&
        nextStatus?.attendeeStatus !== "checked_in";

      timer = window.setTimeout(
        () => void pollStatus(),
        waitingForAttendance ? 2000 : 10000
      );
    }

    void pollStatus();

    return () => {
      cancelled = true;

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [statusUrl]);

  React.useEffect(() => {
    function handleVisibility() {
      if (
        document.visibilityState === "visible" &&
        trackingRef.current
      ) {
        void requestWakeLock();
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopLocalTracking();
    };
  }, []);

  async function requestWakeLock() {
    try {
      const nav = navigator as any;

      if (
        document.visibilityState === "visible" &&
        nav.wakeLock?.request
      ) {
        wakeLockRef.current = await nav.wakeLock.request("screen");
      }
    } catch {}
  }

  function stopLocalTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    try {
      wakeLockRef.current?.release?.();
    } catch {}

    wakeLockRef.current = null;
  }

  async function sendPosition(position: GeolocationPosition) {
    const now = Date.now();

    if (now - lastSentAtRef.current < 15000) {
      return;
    }

    lastSentAtRef.current = now;

    const response = await fetch(
      `/api/events/${encodeURIComponent(eventSlug)}/live-location`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          registrationNumber,
          token: qrToken,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          headingDeg:
            position.coords.heading == null
              ? null
              : position.coords.heading,
          speedMps:
            position.coords.speed == null
              ? null
              : position.coords.speed,
        }),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success !== true) {
      if (
        data.reason === "event_not_live" ||
        data.reason === "not_checked_in" ||
        data.reason === "attendee_not_eligible"
      ) {
        stopLocalTracking();
        setTracking(false);
      }

      throw new Error(
        data.message || "Unable to update safety location."
      );
    }

    setLastUpdatedAt(data.updatedAt || new Date().toISOString());
    setLastAccuracyM(
      typeof data.accuracyM === "number"
        ? data.accuracyM
        : position.coords.accuracy
    );
    setError("");
  }

  async function startTracking() {
    setError("");

    if (!navigator.geolocation) {
      setError("This phone/browser does not support location sharing.");
      return;
    }

    try {
      window.localStorage.setItem(
        storageKey(eventSlug, registrationNumber),
        "allowed"
      );
    } catch {}

    setPromptOpen(false);
    lastSentAtRef.current = 0;

    await requestWakeLock();

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setTracking(true);
        setCurrentPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM:
            Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : null,
          updatedAt: new Date().toISOString(),
        });
        void sendPosition(position).catch((caught) => {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to update safety location."
          );
        });
      },
      (positionError) => {
        setTracking(false);
        setError(
          positionError.code === positionError.PERMISSION_DENIED
            ? "Location permission was denied. Enable location permission for this site, then tap Start Safety Tracking."
            : "Unable to read your phone location. Check GPS and mobile data, then try again."
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );

    watchIdRef.current = watchId;
  }

  async function stopTracking() {
    stopLocalTracking();
    setTracking(false);
    setCurrentPosition(null);
    setPromptOpen(false);

    try {
      await fetch(
        `/api/events/${encodeURIComponent(eventSlug)}/live-location`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            registrationNumber,
            token: qrToken,
          }),
        }
      );
    } catch {}

    try {
      window.localStorage.setItem(
        storageKey(eventSlug, registrationNumber),
        "dismissed"
      );
    } catch {}

    setStatus((current) =>
      current
        ? {
            ...current,
            sharingActive: false,
          }
        : current
    );
  }

  function dismissPrompt() {
    setPromptOpen(false);

    try {
      window.localStorage.setItem(
        storageKey(eventSlug, registrationNumber),
        "dismissed"
      );
    } catch {}
  }

  const available = status?.trackingAvailable === true;

  return (
    <div className="pass-capture-exclude no-print mt-7">
      <div
        className={`rounded-2xl border p-4 ${
          tracking
            ? "border-emerald-300 bg-emerald-50"
            : "border-slate-200 bg-slate-50"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              Live Safety Tracking
            </p>
            <p className="mt-1 text-sm font-bold text-slate-900">
              {tracking
                ? "ON - sharing your latest location with authorized event staff"
                : available
                ? "Available during the Fun Walk"
                : status?.message || "Available only while the event is LIVE"}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-black ${
              tracking
                ? "bg-emerald-600 text-white"
                : "bg-slate-200 text-slate-700"
            }`}
          >
            {tracking ? "ON" : "OFF"}
          </span>
        </div>

        {tracking ? (
          <div className="mt-3 text-xs font-semibold text-slate-600">
            <p>
              Last update: {formatTime(lastUpdatedAt) || "waiting for GPS"}
            </p>
            {lastAccuracyM !== null ? (
              <p className="mt-1">
                GPS accuracy: about {Math.round(lastAccuracyM)} m
              </p>
            ) : null}
            <p className="mt-2">
              Keep this Event Pass open during the walk. Browser tracking may pause if the page is closed or the phone puts the browser to sleep.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-xl bg-red-100 px-3 py-2 text-xs font-bold text-red-800">
            {error}
          </p>
        ) : null}

        {available ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {!tracking ? (
              <button
                type="button"
                onClick={() => void startTracking()}
                className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white"
              >
                Start Safety Tracking
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void stopTracking()}
                className="rounded-xl border border-red-300 bg-white px-4 py-3 text-sm font-black text-red-700"
              >
                Stop Sharing
              </button>
            )}
          </div>
        ) : null}
      </div>

      <EventParticipantLiveMap
        eventSlug={eventSlug}
        eventName={eventName}
        tracking={tracking}
        currentPosition={currentPosition}
      />

      {promptOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 text-slate-950 shadow-2xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
              Participant Safety
            </p>
            <h2 className="mt-2 text-3xl font-black">
              Allow live safety tracking during the Fun Walk?
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              JRide can share your phone's latest location with authorized event staff while {eventName} is LIVE. This is for participant safety only.
            </p>
            <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950">
              <p className="font-black">Privacy and peace of mind</p>
              <p className="mt-2">
                Only your latest location is stored for participant safety. JRide does not save your full route history, and you can stop sharing at any time.
              </p>
              <p className="mt-3 font-black">
                After the event ends, this live tracking session automatically stops and all stored live safety location data is permanently deleted. This event feature cannot continue tracking you afterward.
              </p>
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-600">
              For reliable browser tracking, keep this Event Pass open during the walk and allow location permission when your phone asks.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={dismissPrompt}
                className="rounded-xl border border-slate-300 px-4 py-3 font-black text-slate-700"
              >
                Not Now
              </button>
              <button
                type="button"
                onClick={() => void startTracking()}
                className="rounded-xl bg-emerald-600 px-4 py-3 font-black text-white"
              >
                Allow Safety Tracking
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}