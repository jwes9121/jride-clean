"use client";

import { getOfflineJobs } from "../lib/offlineQueue";

export default function OfflineIndicator() {
  // just read the queue length so the component compiles
  const jobs = getOfflineJobs();
  const isOfflineMode = jobs.length > 0;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        background: isOfflineMode ? "#facc15" : "#10b981",
        color: "#000",
        fontFamily: "system-ui, sans-serif",
        fontSize: ".8rem",
        fontWeight: 600,
        padding: "8px 12px",
        borderRadius: "6px",
        boxShadow:
          "0 8px 24px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.2)",
        border: "1px solid rgba(0,0,0,0.2)",
        minWidth: "120px",
        textAlign: "center",
        lineHeight: 1.3,
        zIndex: 9999,
      }}
    >
      {isOfflineMode ? "Offline - queued" : "Online"}
    </div>
  );
}
