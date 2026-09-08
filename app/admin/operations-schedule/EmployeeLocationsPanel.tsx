"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./schedule.module.css";

type Reading = {
  employee_id: string;
  staff_email: string;
  staff_name: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  device_captured_at: string | null;
  created_at: string;
};

type EmployeeLocation = {
  id: string;
  name: string;
  area: string;
  email: string;
  latest: Reading | null;
};

type Data = {
  employees: EmployeeLocation[];
  serverTime: string;
};

function phTime(value: string | null) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function freshness(reading: Reading | null, serverTime: string | undefined) {
  if (!reading || !serverTime) return { label: "WAITING", stale: true };
  const ageMs = new Date(serverTime).getTime() - new Date(reading.created_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) return { label: "STALE", stale: true };
  return { label: "CURRENT", stale: false };
}

export default function EmployeeLocationsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/employee-location", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.employees)) throw new Error(body.error || "Employee locations are unavailable.");
      setData(body);
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Employee locations are unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(interval);
  }, [load]);

  return <section className={styles.panel}>
    <div className={styles.editorTitle}>
      <div>
        <h2>Employee Locations</h2>
        <p>Latest GPS readings from the Operations Schedule location check. Refreshes every 10 seconds.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
    </div>

    {error && <div className={styles.error}>{error}</div>}
    {loading && !data && <p>Loading employee GPS readings...</p>}

    {data && <div className={styles.teamGrid}>{data.employees.map(employee => {
      const reading = employee.latest;
      const status = freshness(reading, data.serverTime);
      const mapUrl = reading
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${reading.latitude},${reading.longitude}`)}`
        : "";

      return <article key={employee.id}>
        <div className={styles.editorTitle}>
          <div>
            <h3>{employee.name}</h3>
            <small>{employee.area}</small>
          </div>
          <span className={styles.badge}>{status.label}</span>
        </div>

        {!employee.email && <p className={styles.warning}>Google account not linked yet.</p>}

        {reading ? <>
          <p><strong>GPS accuracy: +/- {Math.round(reading.accuracy_m)} m</strong></p>
          <p>Latitude: <strong>{Number(reading.latitude).toFixed(6)}</strong><br />Longitude: <strong>{Number(reading.longitude).toFixed(6)}</strong></p>
          <p>Device captured:<br /><strong>{phTime(reading.device_captured_at)}</strong></p>
          <p>Server received:<br /><strong>{phTime(reading.created_at)}</strong></p>
          {status.stale && <p className={styles.warning}>This is the latest saved reading, but it is more than 15 minutes old.</p>}
          <div className={styles.actions}><button type="button" onClick={() => window.open(mapUrl, "_blank", "noopener,noreferrer")}>Open GPS pin on map</button></div>
        </> : <p>No GPS reading received yet. The employee must open the Operations Schedule and complete the location check.</p>}
      </article>;
    })}</div>}

    {data && !data.employees.length && <p>No coordinators are configured.</p>}
  </section>;
}
