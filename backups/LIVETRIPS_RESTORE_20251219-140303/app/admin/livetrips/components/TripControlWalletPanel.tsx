"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Props = {
  trip: any;
  drivers: any[];
  onRefresh: () => void;
};

function low(v: any) { return String(v ?? "").toLowerCase(); }

function money(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  try { return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n); }
  catch { return `₱${n.toFixed(2)}`; }
}

function pickId(d: any): string {
  return String(d?.uuid ?? d?.driver_uuid ?? d?.driver_id ?? d?.id ?? "");
}

function pickName(d: any): string {
  return String(d?.name ?? d?.driver_name ?? d?.label ?? "").trim();
}

function normalizeDriverList(list: any[]): { id: string; label: string }[] {
  return (list || [])
    .map((d) => {
      const id = pickId(d);
      if (!id) return null;
      const nm = pickName(d);
      const label = nm ? nm : `Driver ${id.slice(0, 4)}`;
      return { id, label };
    })
    .filter(Boolean) as { id: string; label: string }[];
}

// Try to extract “Smart Auto-Assign Suggestions” drivers from trip payload
function extractSuggestionDrivers(trip: any): any[] {
  const candidates = [
    trip?.smart_auto_assign_suggestions,
    trip?.smartAutoAssignSuggestions,
    trip?.auto_assign_suggestions,
    trip?.autoAssignSuggestions,
    trip?.suggestions,
    trip?.auto_assign,
    trip?.autoAssign,
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
    // Sometimes it is nested
    if (c && Array.isArray(c?.drivers) && c.drivers.length) return c.drivers;
    if (c && Array.isArray(c?.items) && c.items.length) return c.items;
  }
  return [];
}

export default function TripControlWalletPanel({ trip, drivers, onRefresh }: Props) {
  const [driverId, setDriverId] = useState("");
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState<string>(trip?.status ?? "pending");
  const [uiMsg, setUiMsg] = useState<string>("");

  // booking identifier (uuid first, then id)
  const bookingUuid = trip?.uuid ?? trip?.booking_uuid ?? trip?.booking_id ?? null;
  const bookingId = trip?.id ?? null;

  const status = low(localStatus || trip?.status);

  // ---- DRIVER SOURCES (priority) ----
  // 1) drivers prop (if present)
  const propDrivers = useMemo(() => normalizeDriverList(drivers || []), [drivers]);

  // 2) suggestions inside trip payload (because your UI already shows them)
  const suggestionDrivers = useMemo(() => {
    const sug = extractSuggestionDrivers(trip);
    return normalizeDriverList(sug);
  }, [trip]);

  // 3) fallback fetch from driver_locations if both are empty
  const [fetchedDrivers, setFetchedDrivers] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;

    async function fetchDrivers() {
      // Only fetch if needed
      if (propDrivers.length || suggestionDrivers.length) return;

      try {
        const { data, error } = await supabase
          .from("driver_locations")
          .select("id,uuid,driver_id,driver_uuid,driver_name,name")
          .limit(100);

        if (error) {
          if (!cancelled) setUiMsg("No drivers in dropdown: driver_locations blocked by RLS or not available.");
          console.error("driver_locations fetch error:", error);
          return;
        }

        const normalized = normalizeDriverList(data || []);
        if (!cancelled) setFetchedDrivers(normalized);
      } catch (e) {
        console.error("driver_locations fetch exception:", e);
      }
    }

    fetchDrivers();
    return () => { cancelled = true; };
  }, [propDrivers.length, suggestionDrivers.length]);

  const driverOpts = useMemo(() => {
    // Merge unique drivers by id
    const all = [...propDrivers, ...suggestionDrivers, ...fetchedDrivers];
    const seen = new Set<string>();
    const out: { id: string; label: string }[] = [];
    for (const d of all) {
      if (!d?.id) continue;
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
    return out;
  }, [propDrivers, suggestionDrivers, fetchedDrivers]);

  // ---- ASSIGN + STATUS (no silent failure) ----
  async function assignDriver() {
    setUiMsg("");
    if (!driverId) { setUiMsg("Select a driver first."); return; }

    const bid = bookingUuid ?? bookingId;
    if (!bid) { setUiMsg("Trip missing booking id/uuid."); return; }

    setBusy(true);
    try {
      // Try common signatures (uuid and id)
      const payloads = [
        { booking_uuid: bid, driver_uuid: driverId, assigned_by: "dispatcher" },
        { booking_uuid: bid, driver_uuid: driverId },
        { booking_id: bid, driver_id: driverId, assigned_by: "dispatcher" },
        { booking_id: bid, driver_id: driverId },
        { p_booking_id: bid, p_driver_id: driverId, p_actor: "dispatcher" },
        { p_booking_id: bid, p_driver_id: driverId },
      ];

      let lastErr: any = null;

      for (const p of payloads) {
        const { error } = await supabase.rpc("dispatcher_assign_driver", p as any);
        if (!error) {
          setLocalStatus("assigned");
          setUiMsg("Assigned ✅");
          await onRefresh?.();
          return;
        }
        lastErr = error;
      }

      console.error("Assign failed:", lastErr);
      setUiMsg(`Assign failed: ${String(lastErr?.message ?? lastErr)}`);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(next: string) {
    setUiMsg("");
    const bidUuid = bookingUuid;
    const bidId = bookingId;

    setBusy(true);
    try {
      // Prefer uuid update
      if (bidUuid) {
        const { error } = await supabase.from("bookings").update({ status: next }).eq("uuid", bidUuid);
        if (!error) {
          setLocalStatus(next);
          setUiMsg(`Status → ${next} ✅`);
          await onRefresh?.();
          return;
        }
        console.error("Status update by uuid failed:", error);
      }

      // Fallback id update
      if (bidId) {
        const { error } = await supabase.from("bookings").update({ status: next }).eq("id", bidId);
        if (!error) {
          setLocalStatus(next);
          setUiMsg(`Status → ${next} ✅`);
          await onRefresh?.();
          return;
        }
        console.error("Status update by id failed:", error);
        setUiMsg(`Status update failed: ${String(error?.message ?? error)}`);
        return;
      }

      setUiMsg("Status update failed: missing uuid/id for booking.");
    } finally {
      setBusy(false);
    }
  }

  // Keep the same visual gating, but dropdown will always populate now
  const canAssign = status === "pending" || status === "unassigned";
  const canOnTheWay = status === "assigned";
  const canStart = status === "on_the_way" || status === "on_theway";
  const canDrop = status === "on_trip" || status === "ontrip";

  return (
    <div className="border-t bg-white p-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold">Trip control & wallet</div>
        <div className="text-[11px] text-slate-500">Status: <span className="font-semibold">{status || "unknown"}</span></div>
      </div>

      {uiMsg && (
        <div className="mb-2 rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">
          {uiMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="rounded border p-2">
          <div className="text-[10px] text-slate-500">Fare</div>
          <div className="text-sm font-semibold">{money(trip?.fare_amount ?? trip?.fare ?? trip?.total_fare ?? trip?.amount)}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-[10px] text-slate-500">Platform fee</div>
          <div className="text-sm font-semibold">{money(trip?.platform_fee ?? trip?.service_fee ?? trip?.total_service_fee)}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-[10px] text-slate-500">Driver wallet</div>
          <div className="text-sm font-semibold">{money(trip?.driver_wallet_balance ?? trip?.driver_wallet ?? trip?.driver_balance)}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-[10px] text-slate-500">Vendor wallet</div>
          <div className="text-sm font-semibold">{money(trip?.vendor_wallet_balance ?? trip?.vendor_wallet ?? trip?.vendor_balance)}</div>
        </div>
      </div>

      <div className="flex gap-2 mb-2">
        <select
          className="flex-1 rounded border px-2 py-1 text-[11px]"
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
        >
          <option value="">Select driver</option>
          {driverOpts.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>

        <button
          className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
          disabled={busy || !canAssign || !driverId}
          onClick={assignDriver}
        >
          Assign
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button className="rounded border px-2 py-2 text-[11px] font-semibold disabled:opacity-40" disabled={busy || !canOnTheWay} onClick={() => setStatus("on_the_way")}>On the way</button>
        <button className="rounded border px-2 py-2 text-[11px] font-semibold disabled:opacity-40" disabled={busy || !canStart} onClick={() => setStatus("on_trip")}>Start trip</button>
        <button className="rounded border px-2 py-2 text-[11px] font-semibold disabled:opacity-40" disabled={busy || !canDrop} onClick={() => setStatus("dropped_off")}>Drop off</button>
      </div>

      <div className="mt-2 text-[10px] text-slate-500">
        Dropdown sources: props → suggestions → driver_locations fallback.
      </div>
    </div>
  );
}
