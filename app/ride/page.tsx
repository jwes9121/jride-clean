"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";

export const dynamic = "force-dynamic";

const STATUS_STEPS = [
  { key: "searching", label: "Searching for Driver" },
  { key: "pending", label: "Booking Created" },
  { key: "assigned", label: "Driver Assigned" },
  { key: "accepted", label: "Driver Accepted" },
  { key: "fare_proposed", label: "Fare Proposed" },
  { key: "ready", label: "Ready" },
  { key: "on_the_way", label: "En Route to Pickup" },
  { key: "arrived", label: "Driver Arrived" },
  { key: "on_trip", label: "Trip In Progress" },
  { key: "completed", label: "Trip Completed" },
];

const TOWNS = [
  { value: "Lagawe", label: "Lagawe", lat: 16.82, lng: 121.11 },
  { value: "Banaue", label: "Banaue", lat: 16.91, lng: 121.06 },
  { value: "Hingyon", label: "Hingyon", lat: 16.78, lng: 121.15 },
];

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
  window.history.replaceState({}, "", "/ride?booking_code=" + encodeURIComponent(code));
}

function authHeaders(): Record<string, string> {
  const t = getAccessToken();
  return t ? { Authorization: "Bearer " + t } : {};
}

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

export default function RidePage() {
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [track, setTrack] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showBookForm, setShowBookForm] = useState(false);
  const [bookForm, setBookForm] = useState({
    town: "Lagawe",
    from_label: "",
    to_label: "",
    pickup_lat: 16.82,
    pickup_lng: 121.11,
    dropoff_lat: 16.82,
    dropoff_lng: 121.11,
    fees_acknowledged: false,
  });
  const [bookSubmitting, setBookSubmitting] = useState(false);
  const [bookError, setBookError] = useState("");

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

    async function resolve() {
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
        const token = getAccessToken();
        if (token) {
          try {
            const res = await fetch(
              "/api/passenger/track?booking_code=" + encodeURIComponent(fromStorage),
              { headers: { Authorization: "Bearer " + token }, cache: "no-store" }
            );
            if (res.ok) {
              const j = await res.json();
              if (j.ok && j.status !== "completed" && j.status !== "cancelled") {
                if (!cancelled) {
                  setBookingCode(fromStorage);
                  setResolving(false);
                }
                replaceRideUrl(fromStorage);
                return;
              }
            }
          } catch {
            // fall through
          }
        }
        clearSavedBookingCode();
      }

      const token = getAccessToken();
      if (token) {
        try {
          const res = await fetch("/api/passenger/latest-booking", {
            headers: authHeaders(),
            cache: "no-store",
          });
          if (res.ok) {
            const j = await res.json();
            if (j.ok && j.booking_code) {
              saveBookingCode(j.booking_code);
              if (!cancelled) {
                setBookingCode(j.booking_code);
                setResolving(false);
              }
              replaceRideUrl(j.booking_code);
              return;
            }
          }
        } catch {
          // fall through
        }
      }

      if (!token) {
        if (!cancelled) setError("Please sign in to book a ride.");
      } else {
        if (!cancelled) setShowBookForm(true);
      }
      if (!cancelled) setResolving(false);
    }

    resolve();

    return () => {
      cancelled = true;
    };
  }, [urlBookingCode]);

  async function handleBookSubmit() {
    const token = getAccessToken();
    if (!token) {
      setBookError("Please sign in first.");
      return;
    }

    if (!bookForm.from_label.trim()) {
      setBookError("Pickup location is required.");
      return;
    }
    if (!bookForm.to_label.trim()) {
      setBookError("Drop-off location is required.");
      return;
    }
    if (!bookForm.fees_acknowledged) {
      setBookError("Please acknowledge the fee notice.");
      return;
    }

    setBookSubmitting(true);
    setBookError("");

    try {
      const town = TOWNS.find((t) => t.value === bookForm.town) || TOWNS[0];

      const res = await fetch("/api/public/passenger/book", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          town: bookForm.town,
          from_label: bookForm.from_label,
          to_label: bookForm.to_label,
          pickup_lat: bookForm.pickup_lat || town.lat,
          pickup_lng: bookForm.pickup_lng || town.lng,
          dropoff_lat: bookForm.dropoff_lat || town.lat,
          dropoff_lng: bookForm.dropoff_lng || town.lng,
          fees_acknowledged: true,
          service_type: "tricycle",
        }),
      });

      const json = await res.json().catch(() => null);

      if (json?.ok && json?.booking_code) {
        saveBookingCode(json.booking_code);
        setBookingCode(json.booking_code);
        setShowBookForm(false);
        setBookError("");
        replaceRideUrl(json.booking_code);
      } else {
        setBookError(json?.message || json?.code || "Booking failed.");
      }
    } catch (e: any) {
      setBookError("Network error: " + (e?.message || "unknown"));
    } finally {
      setBookSubmitting(false);
    }
  }

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
        { headers: { Authorization: "Bearer " + token }, cache: "no-store" }
      );

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Unable to load trip tracking.");
        return;
      }

      const data: TrackData = await res.json();
      setTrack(data);
      setError(null);

      if (data.status === "completed" || data.status === "cancelled") {
        if (intervalRef.current) clearInterval(intervalRef.current);
        clearSavedBookingCode();
      }
    } catch {
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

  const status = track?.status || "--";
  const driverName = track?.driver_name || track?.driver?.name || "--";
  const driverPhone = track?.driver_phone || track?.driver?.phone || "--";
  const pickupKm = track?.pickup_distance_km ?? track?.route?.distance_km ?? null;
  const eta = track?.eta_minutes ?? track?.route?.eta_minutes ?? null;
  const tripKm = track?.trip_distance_km ?? track?.route?.trip_km ?? null;
  const fare = track?.fare ?? track?.verified_fare ?? track?.proposed_fare ?? null;
  const stepIndex = STATUS_STEPS.findIndex((s) => s.key === status);

  if (resolving) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (error && !track && !showBookForm) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", flexDirection: "column", gap: 16 }}>
        <p style={{ color: "#c00", fontSize: 18 }}>{error}</p>
        <a href="/passenger-login" style={{ color: "#0066cc", fontWeight: 600 }}>Go to Login</a>
      </div>
    );
  }

  if (showBookForm && !bookingCode) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Book a Ride</h1>
        <p style={{ color: "#666", marginBottom: 20 }}>Fill in your trip details below.</p>

        {bookError && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: 12, marginBottom: 16, color: "#b91c1c", fontSize: 14 }}>
            {bookError}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Town</label>
            <select
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
              value={bookForm.town}
              onChange={(e) => {
                const t = TOWNS.find((x) => x.value === e.target.value) || TOWNS[0];
                setBookForm((f) => ({
                  ...f,
                  town: e.target.value,
                  pickup_lat: t.lat,
                  pickup_lng: t.lng,
                  dropoff_lat: t.lat,
                  dropoff_lng: t.lng,
                }));
              }}
            >
              {TOWNS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Pickup location</label>
            <input
              type="text"
              placeholder="e.g. Town center, Market area"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
              value={bookForm.from_label}
              onChange={(e) => setBookForm((f) => ({ ...f, from_label: e.target.value }))}
            />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Drop-off location</label>
            <input
              type="text"
              placeholder="e.g. Burnham Park, Hospital"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
              value={bookForm.to_label}
              onChange={(e) => setBookForm((f) => ({ ...f, to_label: e.target.value }))}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              id="fees_ack"
              checked={bookForm.fees_acknowledged}
              onChange={(e) => setBookForm((f) => ({ ...f, fees_acknowledged: e.target.checked }))}
              style={{ width: 18, height: 18 }}
            />
            <label htmlFor="fees_ack" style={{ fontSize: 13 }}>
              I acknowledge the applicable ride fees
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              onClick={handleBookSubmit}
              disabled={bookSubmitting}
              style={{
                padding: "12px 24px", borderRadius: 10, border: "none",
                background: bookSubmitting ? "#93c5fd" : "#2563eb", color: "#fff",
                fontWeight: 700, fontSize: 15, cursor: bookSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {bookSubmitting ? "Booking..." : "Confirm Booking"}
            </button>
            <a
              href="/passenger"
              style={{
                padding: "12px 24px", borderRadius: 10,
                border: "1px solid #ddd", background: "#fff",
                fontWeight: 600, fontSize: 15, textDecoration: "none", color: "#111",
              }}
            >
              Back
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Trip Tracking</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>Booking: {bookingCode}</p>

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
        <Detail label="Fare" value={fare !== null ? "PHP " + fare.toFixed(0) : "--"} />
      </div>

      {error && <p style={{ color: "#c00", fontSize: 14 }}>{error}</p>}

      {status === "completed" && (
        <div style={{ textAlign: "center", padding: 16, background: "#e8f5e9", borderRadius: 10, marginBottom: 16 }}>
          <p style={{ fontWeight: 700, color: "#2e7d32", fontSize: 18, marginBottom: 4 }}>Trip Completed</p>
          <p style={{ color: "#555" }}>Fare: PHP {fare !== null ? fare.toFixed(0) : "--"}</p>
        </div>
      )}

      {(status === "completed" || status === "cancelled") && (
        <button
          onClick={() => {
            clearSavedBookingCode();
            setBookingCode(null);
            setTrack(null);
            setError(null);
            setShowBookForm(true);
            window.history.replaceState({}, "", "/ride");
          }}
          style={{
            display: "block", width: "100%", padding: "12px 24px", borderRadius: 10,
            border: "none", background: "#2563eb", color: "#fff",
            fontWeight: 700, fontSize: 15, cursor: "pointer", textAlign: "center",
          }}
        >
          Book Another Ride
        </button>
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