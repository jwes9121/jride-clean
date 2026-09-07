"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

type SelfStatus = {
  captureAllowed: boolean;
  reason?: string;
  employee?: { id: string; name: string; area: string };
  employees?: unknown[];
};

type CaptureState = "checking" | "ready" | "capturing" | "saved" | "error";

export default function EmployeeGpsCheck({ children }: { children: ReactNode }) {
  const [self, setSelf] = useState<SelfStatus | null>(null);
  const [state, setState] = useState<CaptureState>("checking");
  const [detail, setDetail] = useState("Checking location requirement...");

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/employee-location", { cache: "no-store" });
      const body = (await response.json()) as SelfStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "Location check is unavailable.");
      setSelf(body);
      if (Array.isArray(body.employees)) {
        setState("saved");
        return;
      }
      if (body.captureAllowed) {
        setState((current) => current === "checking" ? "ready" : current);
        setDetail((current) => current === "Checking location requirement..."
          ? "Allow a current GPS reading to continue to the Operations Schedule."
          : current);
      } else {
        setState("ready");
      }
    } catch (error) {
      setState("error");
      setDetail(error instanceof Error ? error.message : "Location check is unavailable.");
    }
  }, []);

  const capture = useCallback(() => {
    if (!self?.captureAllowed) return;
    if (!("geolocation" in navigator)) {
      setState("error");
      setDetail("GPS is not available in this browser or device.");
      return;
    }

    setState("capturing");
    setDetail("Getting a high-accuracy GPS reading...");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch("/api/admin/employee-location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              deviceCapturedAt: new Date(position.timestamp).toISOString(),
            }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "GPS reading could not be saved.");
          setState("saved");
          setDetail("Location check complete.");
        } catch (error) {
          setState("error");
          setDetail(error instanceof Error ? error.message : "GPS reading could not be saved.");
        }
      },
      (error) => {
        setState("error");
        const message = error.code === 1
          ? "Location permission was not granted. Enable location access and retry."
          : error.code === 2
            ? "The device could not determine its location. Turn on GPS and retry."
            : "The GPS request timed out. Move near a window or outside and retry.";
        setDetail(message);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }, [self]);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(loadStatus, self?.captureAllowed ? 10000 : 1500);
    return () => window.clearInterval(interval);
  }, [loadStatus, self?.captureAllowed]);

  if (state === "saved") return <>{children}</>;

  if (self && !self.captureAllowed) {
    return <>{children}</>;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white sm:px-6">
      <div className="mx-auto flex min-h-[75vh] max-w-lg items-center justify-center">
        <section className="w-full rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-400">JRide Staff Operations</div>
          <h1 className="mt-3 text-2xl font-bold">Location check required</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            JRide may request GPS readings at any time while you are logged in to Staff Operations to confirm operational availability for driver and vendor assistance.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            A current GPS reading is required before you can open or grab schedules. Keep Location/GPS on, then continue below.
          </p>
          {self?.employee && <p className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200"><strong>{self.employee.name}</strong><br />{self.employee.area}</p>}
          <p className={`mt-4 rounded-lg p-3 text-sm ${state === "error" ? "bg-red-950 text-red-200" : "bg-slate-800 text-slate-200"}`} aria-live="polite">{detail}</p>
          <button
            type="button"
            onClick={state === "checking" ? loadStatus : capture}
            disabled={state === "capturing"}
            className="mt-5 w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-50"
          >
            {state === "checking" ? "Check requirement" : state === "capturing" ? "Getting GPS..." : "Allow GPS and continue"}
          </button>
        </section>
      </div>
    </main>
  );
}
