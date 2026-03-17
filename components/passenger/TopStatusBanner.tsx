"use client";

import React from "react";

type Props = {
  liveStatus: string;
  activeCode: string;
  nowMessage: string;
  waitHint: string;
};

function toneClass(st: string): string {
  const s = String(st || "").trim().toLowerCase();
  if (s === "fare_proposed" || s === "arrived") return "border-amber-300 bg-amber-50 text-amber-900";
  if (s === "completed") return "border-green-300 bg-green-50 text-green-900";
  if (s === "cancelled") return "border-red-300 bg-red-50 text-red-900";
  if (
    s === "requested" ||
    s === "pending" ||
    s === "searching" ||
    s === "assigned" ||
    s === "accepted" ||
    s === "ready" ||
    s === "on_the_way" ||
    s === "on_trip"
  ) return "border-blue-300 bg-blue-50 text-blue-900";
  return "border-slate-300 bg-slate-50 text-slate-800";
}

export default function TopStatusBanner({
  liveStatus,
  activeCode,
  nowMessage,
  waitHint,
}: Props) {
  if (!String(liveStatus || "").trim() && !String(activeCode || "").trim()) return null;

  return (
    <div className={"mt-3 mb-3 rounded-xl border p-3 text-sm " + toneClass(liveStatus)}>
      <div className="font-semibold">Current trip status</div>
      <div className="mt-1">{nowMessage || "Waiting for live trip updates."}</div>
      {waitHint ? (
        <div className="mt-1 text-xs opacity-80">{waitHint}</div>
      ) : null}
      {activeCode ? (
        <div className="mt-2 text-[11px] opacity-75">
          Booking code: <span className="font-mono">{activeCode}</span>
        </div>
      ) : null}
    </div>
  );
}