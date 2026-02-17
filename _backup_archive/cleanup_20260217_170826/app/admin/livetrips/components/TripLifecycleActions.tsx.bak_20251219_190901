"use client";

import React, { useEffect, useMemo, useState } from "react";

type Props = {
  trip: any | null;
  disabled?: boolean;
  onAfterAction?: () => void; // refresh callback
};

type UiDriver = {
  id: string;
  name: string;
  town: string;
  status: string;
  updatedAt?: string | null;
};

function toStr(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export default function TripLifecycleActions({ trip, disabled, onAfterAction }: Props) {
  const [drivers, setDrivers] = useState<UiDriver[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [driverId, setDriverId] = useState<string>("");
  const [lastAction, setLastAction] = useState<string>("");

  const bookingId = useMemo(() => toStr(trip?.id ?? ""), [trip]);
  const bookingCode = useMemo(() => toStr(trip?.bookingCode ?? trip?.booking_code ?? trip?.code ?? ""), [trip]);

  const tripTown = useMemo(() => {
    const z = trip?.town ?? trip?.zone ?? "Unknown";
    return toStr(z) || "Unknown";
  }, [trip]);

  const canUse = !!trip && !disabled;

  const loadDrivers = async () => {
    setLoadingDrivers(true);
    setLastAction("");
    try {
      const res = await fetch("/api/admin/driver-locations", { cache: "no-store" });
      const j = await res.json().catch(() => ({} as any));

      if (!res.ok || !j?.ok) {
        setDrivers([]);
        setLastAction("Driver list failed to load (admin driver-locations route error).");
        return;
      }

      const rows: any[] = Array.isArray(j.drivers) ? j.drivers : [];
      const mapped: UiDriver[] = rows
        .filter((d) => d && d.driver_id != null)
        .map((d) => {
          const id = String(d.driver_id);
          const town = String(d.town ?? "Unknown");
          return {
            id,
            name: `Driver ${id.slice(0, 4)}`,
            town,
            status: String(d.status ?? "available"),
            updatedAt: d.updated_at ?? null,
          };
        });

      setDrivers(mapped);
    } catch (e: any) {
      setDrivers([]);
      setLastAction(`Driver list failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setLoadingDrivers(false);
    }
  };

  useEffect(() => {
    // load on mount; also reload when trip changes (so ordinance town can filter)
    loadDrivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, bookingCode]);

  const eligibleDrivers = useMemo(() => {
    // Same-town ordinance for normal assign:
    return drivers.filter((d) => (d.town || "Unknown") === tripTown);
  }, [drivers, tripTown]);

  const assignDriver = async (pickedDriverId: string, actor: "dispatcher" | "admin", overrideReason?: string | null) => {
    if (!trip) return;

    setLastAction("");
    const payload = {
      booking_id: bookingId || null,
      booking_code: bookingCode || null,
      driver_id: pickedDriverId,
      actor,
      override_reason: overrideReason ?? null,
    };

    try {
      const res = await fetch("/api/dispatch/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({} as any));

      if (!res.ok || !j?.ok) {
        setLastAction(`Assign FAILED: ${j?.message ?? j?.error ?? "unknown error"}`);
        return;
      }

      setLastAction("Assigned ✅");
      setDriverId("");
      onAfterAction?.();
    } catch (e: any) {
      setLastAction(`Assign FAILED: ${e?.message ?? "unknown error"}`);
    }
  };

  const onClickAssign = async () => {
    if (!driverId) return;
    await assignDriver(driverId, "dispatcher", null);
  };

  const onClickOverride = async () => {
    if (!driverId) return;
    const reason = typeof window !== "undefined" ? window.prompt("Reason for ordinance override? (required)") : null;
    if (!reason || !reason.trim()) return;
    await assignDriver(driverId, "admin", reason.trim());
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          className="w-full rounded border px-2 py-1 text-[11px]"
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          disabled={!canUse || loadingDrivers}
        >
          <option value="">Select driver</option>

          {/* Prefer same-town drivers first */}
          {eligibleDrivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} • {d.town}
            </option>
          ))}

          {/* If none eligible, still show others (for override via separate button) */}
          {eligibleDrivers.length === 0 &&
            drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} • {d.town}
              </option>
            ))}
        </select>

        <button
          className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          disabled={!canUse || !driverId}
          onClick={onClickAssign}
          title="Assign (same-town ordinance)"
        >
          Assign
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
          disabled={!canUse}
          onClick={loadDrivers}
        >
          Recheck drivers
        </button>

        <button
          className="ml-auto rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
          disabled={!canUse || !driverId}
          onClick={onClickOverride}
          title="Emergency override (cross-town passenger only)"
        >
          Override & Assign
        </button>
      </div>

      {loadingDrivers ? (
        <div className="text-[11px] text-slate-400">Loading drivers…</div>
      ) : drivers.length === 0 ? (
        <div className="text-[11px] text-rose-600">
          No drivers loaded from admin driver-locations. (This should bypass RLS—if empty, the table may be empty.)
        </div>
      ) : eligibleDrivers.length === 0 ? (
        <div className="text-[11px] text-amber-600">
          No eligible drivers from {tripTown} (ordinance). Use Override only for emergencies.
        </div>
      ) : (
        <div className="text-[11px] text-slate-500">
          Eligible drivers from {tripTown}: {eligibleDrivers.length}
        </div>
      )}

      {lastAction ? <div className="text-[11px] text-slate-600">Last action: {lastAction}</div> : null}
    </div>
  );
}
