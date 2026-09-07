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

function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  return /FBAN|FBAV|FB_IAB|Messenger|Orca-Android|Instagram/i.test(navigator.userAgent);
}

function currentPosition(options: PositionOptions) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function watchForPosition(options: PositionOptions, waitMs: number) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    let settled = false;
    let watchId = -1;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      if (watchId >= 0) navigator.geolocation.clearWatch(watchId);
      reject(new Error("LOCATION_WATCH_TIMEOUT"));
    }, waitMs);

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        navigator.geolocation.clearWatch(watchId);
        resolve(position);
      },
      (error) => {
        if (settled || error.code !== 1) return;
        settled = true;
        window.clearTimeout(timer);
        navigator.geolocation.clearWatch(watchId);
        reject(error);
      },
      options
    );
  });
}

async function geolocationPermission() {
  try {
    if (!("permissions" in navigator)) return "unknown";
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}

export default function EmployeeGpsCheck({ children }: { children: ReactNode }) {
  const [self, setSelf] = useState<SelfStatus | null>(null);
  const [state, setState] = useState<CaptureState>("checking");
  const [detail, setDetail] = useState("Checking location requirement...");
  const [inAppBrowser, setInAppBrowser] = useState(false);

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
          ? "Allow a current phone location to continue to the Operations Schedule."
          : current);
      } else {
        setState("ready");
      }
    } catch (error) {
      setState("error");
      setDetail(error instanceof Error ? error.message : "Location check is unavailable.");
    }
  }, []);

  const savePosition = useCallback(async (position: GeolocationPosition) => {
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
    if (!response.ok) throw new Error(result.error || "Location reading could not be saved.");
    setState("saved");
    setDetail(`Location check complete. Reported accuracy: +/- ${Math.round(position.coords.accuracy)} meters.`);
  }, []);

  const capture = useCallback(async () => {
    if (!self?.captureAllowed) return;
    if (!("geolocation" in navigator)) {
      setState("error");
      setDetail("Location is not available in this browser or device.");
      return;
    }

    setState("capturing");

    const permission = await geolocationPermission();
    if (permission === "denied") {
      setState("error");
      setDetail("Location access is blocked for this site. Allow location access in the browser, then retry.");
      return;
    }

    setDetail("Getting the phone's latest location...");
    try {
      const recent = await currentPosition({
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,
      });
      await savePosition(recent);
      return;
    } catch (firstError) {
      const geoError = firstError as GeolocationPositionError;
      if (geoError?.code === 1) {
        setState("error");
        setDetail("Location permission was not granted. Allow location access for this site and retry.");
        return;
      }
    }

    setDetail("No recent location was available. Waiting for a fresh GPS/network location...");
    try {
      const fresh = await watchForPosition(
        { enableHighAccuracy: true, maximumAge: 0 },
        45000
      );
      await savePosition(fresh);
      return;
    } catch (secondError) {
      const geoError = secondError as GeolocationPositionError;
      setState("error");
      if (geoError?.code === 1) {
        setDetail("Location permission was not granted. Allow location access for this site and retry.");
      } else if (isInAppBrowser()) {
        setDetail("Messenger could not obtain the phone location. Open this JRide page in your phone browser, then allow location there.");
      } else {
        setDetail("Chrome has not received a location from Android yet. Keep phone Location on, make sure Google Location Accuracy is enabled, then retry.");
      }
    }
  }, [savePosition, self]);

  const openPhoneBrowser = useCallback(() => {
    const url = "https://app.jride.net/admin/operations-schedule";
    if (/Android/i.test(navigator.userAgent)) {
      window.location.href = "intent://app.jride.net/admin/operations-schedule#Intent;scheme=https;end";
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  useEffect(() => {
    setInAppBrowser(isInAppBrowser());
    void loadStatus();
    const interval = window.setInterval(loadStatus, self?.captureAllowed ? 10000 : 1500);
    return () => window.clearInterval(interval);
  }, [loadStatus, self?.captureAllowed]);

  if (state === "saved") return <>{children}</>;

  if (self && !self.captureAllowed) {
    return <>{children}</>;
  }

  const retryStatus = !self;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white sm:px-6">
      <div className="mx-auto flex min-h-[75vh] max-w-lg items-center justify-center">
        <section className="w-full rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-400">JRide Staff Operations</div>
          <h1 className="mt-3 text-2xl font-bold">Location check required</h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            JRide may request location readings at any time while you are logged in to Staff Operations to confirm operational availability for driver and vendor assistance.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            A current or recent phone location is required before you can open or grab schedules. The system records the phone-reported accuracy and timestamp for review.
          </p>
          {self?.employee && <p className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200"><strong>{self.employee.name}</strong><br />{self.employee.area}</p>}
          {inAppBrowser && <div className="mt-4 rounded-lg border border-amber-700 bg-amber-950 p-3 text-sm leading-5 text-amber-100">
            This link is open inside Messenger. Messenger can block or delay location access. You can try the location check below, or open JRide in your phone browser for a more reliable reading.
          </div>}
          <p className={`mt-4 rounded-lg p-3 text-sm ${state === "error" ? "bg-red-950 text-red-200" : "bg-slate-800 text-slate-200"}`} aria-live="polite">{detail}</p>
          <button
            type="button"
            onClick={retryStatus ? loadStatus : capture}
            disabled={state === "capturing"}
            className="mt-5 w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-50"
          >
            {retryStatus ? "Retry location check" : state === "capturing" ? "Getting location..." : "Allow location and continue"}
          </button>
          {inAppBrowser && <button
            type="button"
            onClick={openPhoneBrowser}
            disabled={state === "capturing"}
            className="mt-3 w-full rounded-xl border border-slate-500 bg-slate-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            Open in phone browser
          </button>}
        </section>
      </div>
    </main>
  );
}
