"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";

export const dynamic = "force-dynamic";

const STATUS_STEPS = [
  { key: "searching", label: "Searching" },
  { key: "assigned", label: "Assigned" },
  { key: "accepted", label: "Accepted" },
  { key: "fare_proposed", label: "Fare Proposed" },
  { key: "ready", label: "Ready" },
  { key: "on_the_way", label: "On the Way" },
  { key: "arrived", label: "Arrived" },
  { key: "on_trip", label: "On Trip" },
  { key: "completed", label: "Completed" },
];

const TERMINAL_STATUSES = ["completed", "cancelled", "canceled", "rejected"];

function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("jride_access_token") || null;
  } catch {
    return null;
  }
}

function getSavedBookingCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("jride_active_booking_code") || null;
  } catch {
    return null;
  }
}

function saveBookingCode(code: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("jride_active_booking_code", code);
  } catch {}
}

function clearSavedBookingCode() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("jride_active_booking_code");
  } catch {}
}

function replaceRideUrl(code: string) {
  if (typeof window === "undefined") return;
  const nextUrl = "/ride?booking_code=" + encodeURIComponent(code);
  window.history.replaceState({}, "", nextUrl);
}

interface TrackData {
  ok?: boolean;
  status?: string | null;
  booking_code?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  pickup_distance_km?: number | null;
  eta_minutes?: number | null;
  trip_distance_km?: number | null;
  fare?: number | null;
  proposed_fare?: number | null;
  verified_fare?: number | null;
  driver?: { name?: string | null; phone?: string | null } | null;
  route?: {
    distance_km?: number | null;
    eta_minutes?: number | null;
    trip_km?: number | null;
  } | null;
  error?: string | null;
  message?: string | null;
}

export default function RidePage() {
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [track, setTrack] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const urlBookingCode = useMemo(() => {
    if (typeof window === "undefined") return null;
    const url = new URL(window.location.href);
    const code =
      url.searchParams.get("booking_code") ||
      url.searchParams.get("code") ||
      "";
    return code.trim() || null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolveBookingCode() {
      setResolving(true);
      setError(null);

      const fromUrl = urlBookingCode;
      if (fromUrl) {
        saveBookingCode(fromUrl);
        if (!cancelled) {
          setBookingCode(fromUrl);
          setResolving(false);
        }
        return;
      }

      const fromStorage = getSavedBookingCode();
      if (fromStorage) {
        if (!cancelled) {
          setBookingCode(fromStorage);
          setResolving(false);
        }
        replaceRideUrl(fromStorage);
        return;
      }

      const token = getAccessToken();
      if (token) {
        try {
          const res = await fetch("/api/passenger/latest-booking", {
            method: "GET",
            headers: {
              Authorization: "Bearer " + token,
            },
            cache: "no-store",
          });

          const json = await res.json().catch(() => null);

          if (!cancelled && res.ok && json?.ok && json?.booking_code) {
            const resolvedCode = String(json.booking_code).trim();
            saveBookingCode(resolvedCode);
            setBookingCode(resolvedCode);
            setResolving(false);
            replaceRideUrl(resolvedCode);
            return;
          }
        } catch {
          // fall through
        }
      }

      if (!cancelled) {
        clearSavedBookingCode();
        setTrack(null);
        setError("No active booking found. Please book a ride first.");
        setResolving(false);
      }
    }

    resolveBookingCode();

    return () => {
      cancelled = true;
    };
  }, [urlBookingCode]);

  const fetchTrack = useCallback(async () => {
    if (!bookingCode) return;

    const token = getAccessToken();
    if (!token) {
      setError("Please log in to view your trip.");
      setTrack(null);
      clearSavedBookingCode();
      return;
    }

    try {
      const res = await fetch(
        "/api/passenger/track?booking_code=" + encodeURIComponent(bookingCode) + "&ts=" + Date.now(),
        {
          method: "GET",
          headers: {
            Authorization: "Bearer " + token,
          },
          cache: "no-store",
        }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setTrack(null);
        setError(json?.error || json?.message || "Unable to load trip tracking.");
        return;
      }

      setTrack(json);
      setError(null);

      const normalizedStatus = String(json?.status || "").trim().toLowerCase();

      if (TERMINAL_STATUSES.includes(normalizedStatus)) {
        clearSavedBookingCode();
      } else if (json?.booking_code) {
        saveBookingCode(String(json.booking_code).trim());
      }

      if (normalizedStatus === "completed" || normalizedStatus === "cancelled" || normalizedStatus === "canceled" || normalizedStatus === "rejected") {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch {
      setError("Network error. Retrying...");
    }
  }, [bookingCode]);

  useEffect(() => {
    if (!bookingCode) return;

    fetchTrack();

    intervalRef.current = setInterval(() => {
      fetchTrack();
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [bookingCode, fetchTrack]);

  const status = String(track?.status || "").trim().toLowerCase();
  const stepIndex = STATUS_STEPS.findIndex((s) => s.key === status);

  const driverName = track?.driver_name || track?.driver?.name || "--";
  const driverPhone = track?.driver_phone || track?.driver?.phone || "--";
  const pickupKm = track?.pickup_distance_km ?? track?.route?.distance_km ?? null;
  const eta = track?.eta_minutes ?? track?.route?.eta_minutes ?? null;
  const tripKm = track?.trip_distance_km ?? track?.route?.trip_km ?? null;
  const fare = track?.fare ?? track?.verified_fare ?? track?.proposed_fare ?? null;

  if (resolving) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <p>Loading trip...</p>
      </div>
    );
  }

  if (error && !track) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          flexDirection: "column",
          gap: 16,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p style={{ color: "#c00", fontSize: 18 }}>{error}</p>
        <a href="/passenger" style={{ color: "#0066cc" }}>
          Back to Dashboard
        </a>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Trip Tracking</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>Booking: {bookingCode || "--"}</p>

      <div style={{ marginBottom: 24 }}>
        {STATUS_STEPS.map((step, i) => {
          const done = stepIndex >= 0 && i < stepIndex;
          const active = i === stepIndex;
          return (
            <div
              key={step.key}
              style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: done ? "#4caf50" : active ? "#0066cc" : "#ddd",
                  color: "#fff",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                }}
              >
                {done ? "\u2713" : i + 1}
              </div>
              <span
                style={{
                  fontWeight: active ? 700 : 400,
                  color: done || active ? "#222" : "#999",
                }}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          background: "#f8f8f8",
          borderRadius: 10,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <Detail label="Status" value={status || "--"} />
        <Detail label="Driver" value={driverName || "--"} />
        <Detail label="Phone" value={driverPhone || "--"} />
        <Detail
          label="Pickup Distance"
          value={pickupKm !== null && Number.isFinite(pickupKm) ? pickupKm.toFixed(1) + " km" : "--"}
        />
        <Detail
          label="ETA"
          value={eta !== null && Number.isFinite(eta) ? Math.round(eta) + " min" : "--"}
        />
        <Detail
          label="Trip Distance"
          value={tripKm !== null && Number.isFinite(tripKm) ? tripKm.toFixed(1) + " km" : "--"}
        />
        <Detail
          label="Fare"
          value={fare !== null && Number.isFinite(fare) ? "PHP " + fare.toFixed(2) : "--"}
        />
      </div>

      {error ? <p style={{ color: "#c00", fontSize: 14 }}>{error}</p> : null}

      {status === "completed" ? (
        <div
          style={{
            textAlign: "center",
            padding: 16,
            background: "#e8f5e9",
            borderRadius: 10,
          }}
        >
          <p
            style={{
              fontWeight: 700,
              color: "#2e7d32",
              fontSize: 18,
              marginBottom: 4,
            }}
          >
            Trip Completed
          </p>
          <p style={{ color: "#555", marginBottom: 12 }}>
            Fare: {fare !== null && Number.isFinite(fare) ? "PHP " + fare.toFixed(2) : "--"}
          </p>
          <a href="/passenger" style={{ color: "#0066cc" }}>
            Back to Dashboard
          </a>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: "#888",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
    </div>
  );
}