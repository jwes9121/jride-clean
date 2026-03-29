"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/* ── constants ─────────────────────────────────────────── */
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
/* ── helpers ───────────────────────────────────────────── */
function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("jride_access_token") || null;
}

function getSavedBookingCode(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("jride_active_booking_code") || null;
}

function saveBookingCode(code: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("jride_active_booking_code", code);
  }
}

function authHeaders(): Record<string, string> {
  const t = getAccessToken();
  return t ? { Authorization: "Bearer " + t } : {};
}

/* ── types ─────────────────────────────────────────────── */
interface TrackData {
  ok: boolean;
  status?: string;
  booking_code?: string;
  driver_name?: string;
  driver_phone?: string;
  pickup_distance_km?: number;
  eta_minutes?: number;
  trip_distance_km?: number;
  fare?: number;
  proposed_fare?: number;
  verified_fare?: number;
  driver?: { name?: string; phone?: string };
  route?: { distance_km?: number; eta_minutes?: number; trip_km?: number };
}

/* ── component ─────────────────────────────────────────── */
export default function RidePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [track, setTrack] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Step 1: resolve booking code ───────────────────── */
  useEffect(() => {
    async function resolve() {
      // Priority 1: URL param
      const fromUrl = searchParams.get("booking_code") || searchParams.get("code");
      if (fromUrl) {
        saveBookingCode(fromUrl);
        setBookingCode(fromUrl);
        setResolving(false);
        return;
      }

      // Priority 2: localStorage
      const fromStorage = getSavedBookingCode();
      if (fromStorage) {
        setBookingCode(fromStorage);
        setResolving(false);
        // sync URL
        router.replace("/ride?booking_code=" + encodeURIComponent(fromStorage));
        return;
      }

      // Priority 3: latest-booking API
      const token = getAccessToken();
      if (token) {
        try {
          const res = await fetch("/api/passenger/latest-booking", {
            headers: authHeaders(),
          });
          if (res.ok) {
            const j = await res.json();
            if (j.ok && j.booking_code) {
              saveBookingCode(j.booking_code);
              setBookingCode(j.booking_code);
              setResolving(false);
              router.replace("/ride?booking_code=" + encodeURIComponent(j.booking_code));
              return;
            }
          }
        } catch (_) {
          /* fall through */
        }
      }

      setError("No active booking found. Please book a ride first.");
      setResolving(false);
    }
    resolve();
  }, [searchParams, router]);

  /* ── Step 2: poll /api/passenger/track ──────────────── */
  const fetchTrack = useCallback(async () => {
    if (!bookingCode) return;
    const token = getAccessToken();
    if (!token) {
      setError("Please log in to view your trip.");
      return;
    }
    try {
      const res = await fetch(
        "/api/passenger/track?booking_code=" + encodeURIComponent(bookingCode),
        { headers: { Authorization: "Bearer " + token } }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Unable to load trip tracking.");
        return;
      }
      const data: TrackData = await res.json();
      setTrack(data);
      setError(null);

      // stop polling once completed or cancelled
      if (data.status === "completed" || data.status === "cancelled") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch (e: any) {
      setError("Network error. Retrying...");
    }
  }, [bookingCode]);

  useEffect(() => {
    if (!bookingCode) return;
    fetchTrack();
    intervalRef.current = setInterval(fetchTrack, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [bookingCode, fetchTrack]);

  /* ── derived display values ─────────────────────────── */
  const status = track?.status || "--";
  const driverName = track?.driver_name || track?.driver?.name || "--";
  const driverPhone = track?.driver_phone || track?.driver?.phone || "--";
  const pickupKm = track?.pickup_distance_km ?? track?.route?.distance_km ?? null;
  const eta = track?.eta_minutes ?? track?.route?.eta_minutes ?? null;
  const tripKm = track?.trip_distance_km ?? track?.route?.trip_km ?? null;
  const fare = track?.fare ?? track?.verified_fare ?? track?.proposed_fare ?? null;

  const stepIndex = STATUS_STEPS.findIndex((s) => s.key === status);

  /* ── render ─────────────────────────────────────────── */
  if (resolving) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <p>Loading trip...</p>
      </div>
    );
  }

  if (error && !track) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", flexDirection: "column", gap: 16 }}>
        <p style={{ color: "#c00", fontSize: 18 }}>{error}</p>
        <a href="/passenger-login" style={{ color: "#0066cc" }}>Go to Login</a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Trip Tracking</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>Booking: {bookingCode}</p>

      {/* ── status progress ── */}
      <div style={{ marginBottom: 24 }}>
        {STATUS_STEPS.map((step, i) => {
          const done = i <= stepIndex;
          const active = i === stepIndex;
          return (
            <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                background: done ? (active ? "#0066cc" : "#4caf50") : "#ddd",
                color: "#fff", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700,
              }}>
                {done ? "\u2713" : i + 1}
              </div>
              <span style={{ fontWeight: active ? 700 : 400, color: done ? "#222" : "#999" }}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── details grid ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
        background: "#f8f8f8", borderRadius: 10, padding: 16, marginBottom: 24,
      }}>
        <Detail label="Status" value={status} />
        <Detail label="Driver" value={driverName} />
        <Detail label="Phone" value={driverPhone} />
        <Detail label="Pickup Distance" value={pickupKm !== null ? pickupKm.toFixed(1) + " km" : "--"} />
        <Detail label="ETA" value={eta !== null ? eta + " min" : "--"} />
        <Detail label="Trip Distance" value={tripKm !== null ? tripKm.toFixed(1) + " km" : "--"} />
        <Detail label="Fare" value={fare !== null ? "R " + fare.toFixed(0) : "--"} />
      </div>

      {error && <p style={{ color: "#c00", fontSize: 14 }}>{error}</p>}

      {status === "completed" && (
        <div style={{ textAlign: "center", padding: 16, background: "#e8f5e9", borderRadius: 10 }}>
          <p style={{ fontWeight: 700, color: "#2e7d32", fontSize: 18, marginBottom: 4 }}>Trip Completed</p>
          <p style={{ color: "#555" }}>Fare: R {fare !== null ? fare.toFixed(0) : "--"}</p>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
