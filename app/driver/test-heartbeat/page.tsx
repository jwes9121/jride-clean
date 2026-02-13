"use client";

import { useEffect, useRef, useState } from "react";

export default function DriverHeartbeatPage() {
  const [driverId, setDriverId] = useState<string>("");
  const [isAvailable, setIsAvailable] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastStatus, setLastStatus] = useState<string>("");
  const timerRef = useRef<number | null>(null);

  // ask for location permission early
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }, []);

  async function pingOnce() {
    if (!driverId) {
      setLastStatus("Enter your Driver ID first.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setLastStatus("Geolocation not available on this device.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/driver-heartbeat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              driverId,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              isAvailable,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setLastStatus(`ERROR: ${json.error || res.status}`);
          } else {
            setLastStatus(
              `Sent: lat=${pos.coords.latitude.toFixed(5)}, lng=${pos.coords.longitude.toFixed(5)} (${json.status})`
            );
          }
        } catch (e: any) {
          setLastStatus(`ERROR: ${e?.message ?? "network"}`);
        }
      },
      (err) => setLastStatus(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function start() {
    if (running) return;
    setRunning(true);
    void pingOnce();
    timerRef.current = window.setInterval(pingOnce, 5000);
  }

  function stop() {
    setRunning(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => () => stop(), []);

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">JRide — Driver Test Heartbeat</h1>

      <label className="block text-sm">Driver ID (UUID from the Drivers table)</label>
      <input
        className="w-full border rounded-lg px-3 py-2"
        placeholder="e.g. 3b0b1f5a-...."
        value={driverId}
        onChange={(e) => setDriverId(e.target.value.trim())}
      />

      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={isAvailable}
          onChange={(e) => setIsAvailable(e.target.checked)}
        />
        Available for jobs
      </label>

      <div className="flex gap-2">
        <button
          className="px-3 py-2 border rounded-lg"
          onClick={start}
          disabled={running}
          title="Start sending GPS every 5 seconds"
        >
          Start
        </button>
        <button className="px-3 py-2 border rounded-lg" onClick={stop} disabled={!running}>
          Stop
        </button>
        <button className="px-3 py-2 border rounded-lg" onClick={() => void pingOnce()}>
          Send once
        </button>
      </div>

      <div className="text-sm opacity-80">Status: {lastStatus || "—"}</div>

      <div className="text-xs opacity-60">
        Keep this page open and allow location access. Battery optimizations may delay updates on some phones.
      </div>
    </div>
  );
}
