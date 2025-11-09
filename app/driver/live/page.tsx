"use client";

import { useState } from "react";
import {
  startDriverTracking,
  stopDriverTracking,
} from "@/lib/driver-tracking";

export default function DriverLivePage() {
  const [online, setOnline] = useState(false);
  const [town, setTown] = useState("Lagawe");
  const [statusMsg, setStatusMsg] = useState("");

  const handleToggle = () => {
    if (!online) {
      setStatusMsg("Starting tracking…");
      startDriverTracking(town);
      setOnline(true);
      setStatusMsg("You are ONLINE and sharing your live location.");
    } else {
      setStatusMsg("Stopping tracking…");
      stopDriverTracking(town);
      setOnline(false);
      setStatusMsg("You are OFFLINE.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100">
      <h1 className="text-xl font-semibold mb-2">JRide Driver Live</h1>
      <p className="text-xs text-slate-400 mb-4">
        This page sends your live location to the JRide admin map while Online.
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
        <p className="mt-3 text-xs text-slate-300">{statusMsg}</p>
      )}
    </div>
  );
}
