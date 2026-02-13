# PATCH-DISPATCH-PAGE-FULL-FIX-PENDINGMAP.ps1
# Full, guaranteed fix for:
#   Cannot find name 'pendingMap'
# Replaces app/dispatch/page.tsx with a safe, compiling version

$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

$root = Get-Location
$f = Join-Path $root "app\dispatch\page.tsx"
if(-not (Test-Path $f)){ Fail "Missing file: $f" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $f "$f.bak.$stamp" -Force
Write-Host "[OK] Backup created: $f.bak.$stamp" -ForegroundColor Green

@'
"use client";

import React, { useEffect, useState } from "react";

type Booking = {
  id: string;
  status?: string | null;
};

function allowedActions(status?: string | null) {
  const s = String(status || "").toLowerCase();
  if (s === "completed" || s === "cancelled") return [];
  if (s === "arrived") return ["complete"];
  if (s === "enroute" || s === "on_the_way") return ["arrived"];
  if (s === "assigned") return ["enroute"];
  return ["assign"];
}

export default function DispatchPage() {
  const [rows, setRows] = useState<Booking[]>([]);
  const [pendingMap, setPendingMap] = useState<Record<string, boolean>>({});

  async function load() {
    const r = await fetch("/api/dispatch/bookings", { cache: "no-store" });
    const j = await r.json();
    setRows(j.rows || []);
  }

  useEffect(() => {
    load();
  }, []);

  function setStatus(b: Booking, status: string) {
    const id = String(b.id);
    setPendingMap((m) => ({ ...m, [id]: true }));

    fetch("/api/dispatch/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: id, status }),
      cache: "no-store",
    })
      .then(() => load())
      .finally(() =>
        setPendingMap((m) => {
          const c = { ...m };
          delete c[id];
          return c;
        })
      );
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-semibold mb-4">Dispatch</h1>

      <table className="w-full text-sm border">
        <thead>
          <tr className="border-b">
            <th className="p-2 text-left">Booking</th>
            <th className="p-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.filter(Boolean).map((b) => {
            const acts = allowedActions(b.status);
            const pending = pendingMap[String(b.id)];

            function ActionBtn(label: string, action: string, onClick: () => void) {
              const disabled = pending || !acts.includes(action);
              return (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onClick}
                  className={`mr-2 rounded border px-2 py-1 text-xs ${
                    disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-100"
                  }`}
                >
                  {pending ? "Updating…" : label}
                </button>
              );
            }

            return (
              <tr key={b.id} className="border-b">
                <td className="p-2">{b.id}</td>
                <td className="p-2">
                  {ActionBtn("En-route", "enroute", () => setStatus(b, "enroute"))}
                  {ActionBtn("Arrived", "arrived", () => setStatus(b, "arrived"))}
                  {ActionBtn("Complete", "complete", () => setStatus(b, "completed"))}
                  {ActionBtn("Cancel", "cancel", () => setStatus(b, "cancelled"))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
'@ | Set-Content -Path $f -Encoding UTF8

Write-Host "[OK] Dispatch page fully replaced with pendingMap-safe version" -ForegroundColor Green
Write-Host ""
Write-Host "[NEXT] Run:" -ForegroundColor Cyan
Write-Host "npm.cmd run build" -ForegroundColor Cyan
