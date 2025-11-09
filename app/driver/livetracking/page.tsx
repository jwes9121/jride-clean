"use client";

import { useState } from "react";
import {
  startDriverTracking,
  stopDriverTracking,
  UpsertResult,
} from "@/lib/driver-tracking";

export default function DriverLiveTrackingPage() {
  const [online, setOnline] = useState(false);
  const [town, setTown] = useState("Lagawe");
  const [statusMsg, setStatusMsg] = useState("You are OFFLINE.");

  const handleToggle = async () => {
    if (!online) {
      setStatusMsg("Starting tracking…");

      const result: UpsertResult = await startDriverTracking(town);

      if (result === "no-user") {
        setOnline(false);
        setStatusMsg(
          "Please sign in as a JRide driver first. Live tracking requires an authenticated driver account."
        );
        return;
      }

      if (result === "error") {
        setOnline(false);
        setStatusMsg(
          "Unable to start tracking. Check location permission and try again."
        );
        return;
      }

      setOnline(true);
      setStatusMsg(
        "You are ONLINE and sharing your live location with JRide admin."
      );
    } else {
      setStatusMsg("Stopping tracking…");

      const result: UpsertResult = await stopDriverTracking(town);

      setOnline(false);

      if (result === "ok") {
        setStatusMsg("You are OFFLINE.");
      } else {
        setStatusMsg(
          "Tracking stopped locally. (If this persists, contact support.)"
        );
      }
    }
  };

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
        {online ? "Go Offline" : "Go Online"}
      </button>

      {statusMsg && (
        <p className="mt-3 text-xs text-slate-300 text-center max-w-md">
          {statusMsg}
        </p>
      )}
    </div>
  );
}
