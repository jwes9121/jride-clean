"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SelfStatus = {
  captureAllowed: boolean;
  reason?: string;
  employee?: { id: string; name: string; area: string };
  latest?: { accuracy_m: number; created_at: string } | null;
};

type CaptureState = "checking" | "ready" | "capturing" | "saved" | "error";

export default function EmployeeGpsCheck() {
  const [self, setSelf] = useState<SelfStatus | null>(null);
  const [state, setState] = useState<CaptureState>("checking");
  const [detail, setDetail] = useState("Checking staff GPS test status...");
  const autoStarted = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/employee-location", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as SelfStatus;
      setSelf(body);
      if (body.captureAllowed) {
        setState((current) => current === "checking" ? "ready" : current);
        setDetail((current) => current === "Checking staff GPS test status..."
          ? "GPS accuracy test is ready. You can continue choosing your schedule."
          : current);
      }
    } catch {
      // The schedule itself must remain usable if the optional GPS test is temporarily unavailable.
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
          const accuracy = Math.round(Number(result.reading?.accuracy_m || position.coords.accuracy));
          setState("saved");
          setDetail(`GPS test saved. Reported accuracy: +/- ${accuracy} meters.`);
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
    const interval = window.setInterval(loadStatus, 10000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    if (!self?.captureAllowed || autoStarted.current) return;
    autoStarted.current = true;
    const timer = window.setTimeout(capture, 12000);
    return () => window.clearTimeout(timer);
  }, [capture, self?.captureAllowed]);

  if (!self?.captureAllowed) return null;

  return (
    <aside className="fixed bottom-3 right-3 z-50 w-[min(92vw,360px)] rounded-xl border border-slate-300 bg-white p-4 text-slate-900 shadow-xl" aria-live="polite">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">JRide GPS accuracy test</div>
      <div className="mt-1 text-sm font-semibold">{self.employee?.name} / {self.employee?.area}</div>
      <p className="mt-2 text-sm leading-5 text-slate-700">One work-location reading is requested on this staff page for the accuracy test. You can continue choosing your schedule.</p>
      <p className="mt-2 text-sm leading-5 text-slate-700">{detail}</p>
      <button
        type="button"
        onClick={capture}
        disabled={state === "capturing"}
        className="mt-3 rounded-lg border border-slate-400 bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {state === "capturing" ? "Getting GPS..." : state === "saved" ? "Refresh GPS reading" : "Run GPS test now"}
      </button>
    </aside>
  );
}
