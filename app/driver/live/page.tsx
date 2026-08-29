"use client";

import { useState } from "react";
import {
  startDriverTracking,
  stopDriverTracking,
  UpsertResult,
} from "@/lib/driver-tracking";
import AgrimarketDriverPanel from "./AgrimarketDriverPanel";

export default function DriverLivePage() {
  const [online, setOnline] = useState(false);
  const [town, setTown] = useState("Lagawe");
  const [statusMsg, setStatusMsg] = useState("You are OFFLINE.");

  const handleToggle = async () => {
    if (!online) {
      setStatusMsg("Starting tracking...");

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
      setStatusMsg("Stopping tracking...");

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
    <main className="min-h-screen bg-slate-950 px-3 py-6 text-slate-100 sm:px-5">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
        <h1 className="text-xl font-semibold">JRide Driver Live</h1>
        <p className="mt-2 max-w-xl text-center text-xs text-slate-400">
          Keep this page Online so JRide can use your fresh location for ride and delivery assignment.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <label className="text-xs text-slate-300">
            Town:
            <input
              value={town}
              onChange={(e) => setTown(e.target.value)}
              disabled={online}
              className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs disabled:opacity-60"
            />
          </label>

          <button
            onClick={handleToggle}
            className={`rounded px-4 py-2 text-sm font-medium ${
              online
                ? "bg-red-600 hover:bg-red-500"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {online ? "Go Offline" : "Go Online"}
          </button>
        </div>

        {statusMsg ? (
          <p className="mt-3 max-w-md text-center text-xs text-slate-300">
            {statusMsg}
          </p>
        ) : null}

        <AgrimarketDriverPanel online={online} />
      </div>
    </main>
  );
}
