"use client";

import { useEffect, useState } from "react";
import {
  startDriverTracking,
  stopDriverTracking,
  UpsertResult,
} from "@/lib/driver-tracking";
import { supabase } from "@/lib/supabaseDriverClient";

export default function DriverLiveTrackingPage() {
  const [online, setOnline] = useState(false);
  const [town, setTown] = useState("Lagawe");
  const [statusMsg, setStatusMsg] = useState("Checking driver session…");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data?.user) {
        setIsAuthenticated(false);
        setStatusMsg(
          "Please sign in as a JRide driver first. Live tracking requires an authenticated driver account."
        );
      } else {
        setIsAuthenticated(true);
        setStatusMsg("You are OFFLINE.");
      }
    });
  }, []);

  const handleToggle = async () => {
    // If not logged in, send straight to login
    if (!isAuthenticated) {
      window.location.href = "/driver/login";
      return;
    }

    if (!online) {
      setStatusMsg("Starting tracking…");
      const result: UpsertResult = await startDriverTracking(town);

      if (result === "ok") {
        setOnline(true);
        setStatusMsg(
          "You are ONLINE and sharing your live location with JRide admin."
        );
      } else {
        setOnline(false);
        setStatusMsg(
          "Unable to start tracking. Check location permission and try again."
        );
      }
    } else {
      setStatusMsg("Stopping tracking…");
      const result: UpsertResult = await stopDriverTracking(town);

      setOnline(false);
      setStatusMsg(
        result === "ok"
          ? "You are OFFLINE."
          : "Tracking stopped locally. If your status looks wrong in admin, please contact support."
      );
    }
  };

  const buttonLabel =
    isAuthenticated === false
      ? "Sign in to Start"
      : online
      ? "Go Offline"
      : "Go Online";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100">
      <h1 className="text-xl font-semibold mb-2">
        JRide Driver Live Tracking
      </h1>
      <p className="text-xs text-slate-400 mb-4">
        Toggle Online to send your location to the JRide admin live map.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs text-slate-300">
          Town:
          <input
            value={town}
            onChange={(e) => setTown(e.target.value)}
            className="ml-2 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs"
          />
        </label>
      </div>

      <button
        onClick={handleToggle}
        className={`px-4 py-2 rounded font-medium text-sm ${
          online
            ? "bg-red-600 hover:bg-red-500"
            : "bg-emerald-600 hover:bg-emerald-500"
        }`}
      >
        {buttonLabel}
      </button>

      <div className="mt-3 flex flex-col items-center gap-2 text-xs text-slate-300 max-w-md text-center">
        <span>{statusMsg}</span>
        {isAuthenticated === false && (
          <a
            href="/driver/login"
            className="inline-block mt-1 px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-[10px] font-medium"
          >
            Go to Driver Login
          </a>
        )}
      </div>
    </div>
  );
}
