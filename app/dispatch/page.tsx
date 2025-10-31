"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabaseClient";

const EnvGuard: React.FC = () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <div className="my-3 p-3 rounded bg-yellow-50 text-yellow-800 border">
        Supabase env not set. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in Vercel.
      </div>
    );
  }
  return null;
};

const PickupMapModal = dynamic(() => import("@/components/PickupMapModal"), { ssr: false });

type Driver = { id: string; name: string | null; town: string | null; online: boolean };
type BookingStatus = "pending" | "assigned" | "en_route" | "arrived" | "completed" | "cancelled" | string;
type Booking = {
  id: string;
  rider_name: string | null;
  pickup_town: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  status: BookingStatus;
  assigned_driver_id: string | null;
  created_at: string;
};
type TownRow = { name: string; color: string };
type Candidate = {
  driver_id: string;
  name: string | null;
  town: string | null;
  online: boolean;
  busy: boolean;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  eta_min: number | null;
};

type Toast = { id: string; title: string; description?: string };
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((p) => [...p, { id, ...t }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 3000);
  };
  return { toasts, push };
}

async function roadEta(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const q = new URLSearchParams({
    fromLat: String(fromLat), fromLng: String(fromLng),
    toLat: String(toLat), toLng: String(toLng),
  });
  const r = await fetch(`/api/eta?${q.toString()}`, { cache: "no-store" });
  if (!r.ok) return null;
  return (await r.json()) as { minutes: number | null; km: number | null };
}

export default function Dispatch
<EnvGuard />Page() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [towns, setTowns] = useState<TownRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [townDraft, setTownDraft] = useState<Record<string, string>>({});
  const [savingTownId, setSavingTownId] = useState<string | null>(null);

  const [selectedDriverByBooking, setSelectedDriverByBooking] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const [overrideDriverByBooking, setOverrideDriverByBooking] = useState<Record<string, string>>({});
  const [onlineOnly, setOnlineOnly] = useState(true);

  const [candidatesByBooking, setCandidatesByBooking] = useState<Record<string, Candidate[]>>({});
  const [etaCache, setEtaCache] = useState<Record<string, string>>({});

  // Map modal
  const [mapOpenFor, setMapOpenFor] = useState<string | null>(null);
  const [mapInitial, setMapInitial] = useState<{ lat: number; lng: number } | null>(null);

  const { toasts, push } = useToast();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [d1, d2, d3] = await Promise.all([
        supabase.from("drivers").select(),
        supabase.from("bookings").select().order("created_at", { ascending: false }),
        supabase.rpc("list_dispatch
<EnvGuard />_towns"),
      ]);
      if (!d1.error && d1.data) setDrivers(d1.data as Driver[]);
      if (!d2.error && d2.data) setBookings(d2.data as Booking[]);
      if (!d3.error && d3.data) setTowns(d3.data as TownRow[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const channel = supabase.channel("bookings-rt");
    channel.on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, (payload) => {
      const row = payload.new as Booking;
      setBookings((prev) => {
        const i = prev.findIndex((b) => b.id === row.id);
        if (i === -1) return [row, ...prev];
        const copy = [...prev];
        copy[i] = row;
        return copy;
      });
    });
    channel.subscribe();
    return () => { try { /* @ts-ignore */ supabase.removeChannel(channel); } catch {} };
  }, []);

  const busyDriverIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of bookings) {
      if (b.assigned_driver_id && ["assigned", "en_route", "arrived"].includes(b.status)) {
        s.add(b.assigned_driver_id);
      }
    }
    return s;
  }, [bookings]);

  const townColor = (t?: string | null) => {
    if (!t) return "#e5e7eb";
    const row = towns.find((x) => x.name.toLowerCase() === t.trim().toLowerCase());
    return row?.color ?? "#e5e7eb";
  };
  const townList = towns.map((t) => t.name);

  useEffect(() => {
    (async () => {
      const idsNeeding = bookings.filter((b) => b.pickup_town && !candidatesByBooking[b.id]).map((b) => b.id);
      if (!idsNeeding.length) return;
      const updates: Record<string, Candidate[]> = {};
      for (const id of idsNeeding) {
        const { data, error } = await supabase.rpc("drivers_for_booking", { p_booking_id: id });
        if (!error && data) updates[id] = data as Candidate[];
      }
      if (Object.keys(updates).length) setCandidatesByBooking((prev) => ({ ...prev, ...updates }));
    })();
  }, [bookings, candidatesByBooking]);

  async function saveTown(bookingId: string) {
    const town = (townDraft[bookingId] ?? "").trim();
    if (!town) return;
    setSavingTownId(bookingId);
    try {
      const { data, error } = await supabase.rpc("set_booking_town", { p_booking_id: bookingId, p_pickup_town: town });
      if (error) throw error;
      if (data) {
        setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, pickup_town: data.pickup_town } : b)));
      }
      const { data: cand } = await supabase.rpc("drivers_for_booking", { p_booking_id: bookingId });
      if (cand) setCandidatesByBooking((prev) => ({ ...prev, [bookingId]: cand as Candidate[] }));
      push({ title: "Town saved" });
    } catch (e: any) {
      push({ title: "Save failed", description: e?.message ?? "Unknown error" });
    } finally {
      setSavingTownId(null);
    }
  }

  async function handleAssign(bookingId: string) {
    const driverId = selectedDriverByBooking[bookingId];
    if (!driverId) return push({ title: "Pick a driver first" });
    setAssigningId(bookingId);
    try {
      const { data, error } = await supabase.rpc("assign_driver", { p_booking_id: bookingId, p_driver_id: driverId });
      if (error) throw error;
      if (data) {
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: "assigned", assigned_driver_id: driverId } : b))
        );
      }
      push({ title: "Assigned ✅" });
    } catch (e: any) {
      push({ title: "Assign failed", description: e?.message ?? "Unknown error" });
    } finally {
      setAssigningId(null);
    }
  }

  async function handleAssignOverride(bookingId: string) {
    const driverId = overrideDriverByBooking[bookingId];
    if (!driverId) return push({ title: "Pick a driver first (override)" });
    const reason = window.prompt("Override reason (required):")?.trim();
    if (!reason) return push({ title: "Override cancelled", description: "Reason required." });
    setAssigningId(bookingId);
    try {
      const { data, error } = await supabase.rpc("assign_driver_override", {
        p_booking_id: bookingId, p_driver_id: driverId, p_reason: reason,
      });
      if (error) throw error;
      if (data) {
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: "assigned", assigned_driver_id: driverId } : b))
        );
      }
      push({ title: "Assigned (override) ✅" });
    } catch (e: any) {
      push({ title: "Override failed", description: e?.message ?? "Unknown error" });
    } finally {
      setAssigningId(null);
    }
  }

  async function setStatus(bookingId: string, next: BookingStatus) {
    try {
      const { data, error } = await supabase.rpc("update_booking_status", { p_booking_id: bookingId, p_next: next });
      if (error) throw error;
      if (data) setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, status: data.status } : b)));
      push({ title: `Status: ${next}` });
    } catch (e: any) {
      push({ title: "Update failed", description: e?.message ?? "Unknown error" });
    }
  }

  function canAssign(b: Booking) { return !!b.pickup_town && b.status === "pending"; }

  // Open modal helper
  function openPickupModal(b: Booking) {
    const start =
      b.pickup_lat != null && b.pickup_lng != null
        ? { lat: b.pickup_lat, lng: b.pickup_lng }
        : { lat: 16.803, lng: 121.104 }; // Ifugao center fallback
    setMapInitial(start);
    setMapOpenFor(b.id);
  }

  async function savePickupFromModal(lat: number, lng: number) {
    const bookingId = mapOpenFor!;
    try {
      const { data, error } = await supabase.rpc("set_booking_pickup_point", {
        p_booking_id: bookingId, p_lat: lat, p_lng: lng,
      });
      if (error) throw error;
      // update local booking + flush ETA cache for that booking
      setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, pickup_lat: lat, pickup_lng: lng } : b)));
      setEtaCache((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => { if (k.startsWith(bookingId + ":")) delete next[k]; });
        return next;
      });
      push({ title: "Pickup saved ✅" });
    } catch (e: any) {
      push({ title: "Save pickup failed", description: e?.message ?? "Unknown error" });
    } finally {
      setMapOpenFor(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dispatch</h1>
<EnvGuard />
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} />
          <span>Online drivers only</span>
        </label>
      </div>

      {loading ? (
        <div className="text-sm opacity-70">Loading…</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Created</th>
              <th>Rider</th>
              <th>Pickup Town</th>
              <th>Status</th>
              <th>Assign</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => {
              const candidates = (candidatesByBooking[b.id] ?? []).filter((c) => (onlineOnly ? c.online : true));
              const selected = selectedDriverByBooking[b.id] ?? "";
              const overrideSelected = overrideDriverByBooking[b.id] ?? "";

              return (
                <tr key={b.id} className="border-b align-top">
                  <td className="py-2">{new Date(b.created_at).toLocaleString()}</td>
                  <td>—</td>

                  <td className="py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ background: townColor(b.pickup_town) }} />
                      <input
                        className="border rounded px-2 py-1 w-44"
                        placeholder="Set town"
                        value={townDraft[b.id] ?? b.pickup_town ?? ""}
                        list="dispatch
<EnvGuard />-towns"
                        onChange={(e) => setTownDraft((prev) => ({ ...prev, [b.id]: e.target.value }))}
                      />
                      <button
                        onClick={() => saveTown(b.id)}
                        disabled={savingTownId === b.id || !(townDraft[b.id] ?? b.pickup_town)}
                        className={"px-3 py-1 rounded text-sm text-white " + (savingTownId === b.id ? "bg-gray-400" : "bg-black")}
                      >
                        {savingTownId === b.id ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={() => openPickupModal(b)}
                        className="px-3 py-1 rounded text-sm border bg-white"
                        title="Pick exact pickup point on map"
                      >
                        Set pickup on map
                      </button>
                      {b.pickup_lat != null && b.pickup_lng != null && (
                        <span className="text-xs opacity-60">
                          ({b.pickup_lat.toFixed(4)}, {b.pickup_lng.toFixed(4)})
                        </span>
                      )}
                    </div>
                    {!b.pickup_town && <div className="text-xs opacity-60 mt-1">Set town to enable assignment</div>}
                  </td>

                  <td className="py-2">
                    <span
                      className={
                        "px-2 py-1 rounded text-xs " +
                        (b.status === "assigned" ? "bg-green-100" :
                         b.status === "en_route" ? "bg-blue-100" :
                         b.status === "arrived"  ? "bg-yellow-100" :
                         b.status === "completed" ? "bg-emerald-100" :
                         b.status === "cancelled" ? "bg-red-100" : "bg-gray-100")
                      }
                    >
                      {b.status}
                    </span>
                  </td>

                  <td className="py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        className="border rounded px-2 py-1"
                        value={selected}
                        onChange={(e) => setSelectedDriverByBooking((p) => ({ ...p, [b.id]: e.target.value }))}
                        disabled={!canAssign(b) || candidates.length === 0}
                        title={!b.pickup_town ? "Set town first" : candidates.length === 0 ? "No available drivers" : "Pick driver"}
                      >
                        <option value="">
                          {b.pickup_town ? (candidates.length ? `Pick driver (${b.pickup_town})` : `No available drivers`) : "Set town first"}
                        </option>
                        {candidates.map((c) => {
                          let label = `${c.name ?? c.driver_id.slice(0, 8)}${c.busy ? " • busy" : ""}`;
                          if (c.eta_min != null) label += ` • ~${Math.max(1, Math.round(c.eta_min))}m (air)`;
                          else if (c.distance_km != null) label += ` • ${c.distance_km.toFixed(1)}km (air)`;
                          const hasPickup = b.pickup_lat != null && b.pickup_lng != null;
                          const hasDriver = c.lat != null && c.lng != null;
                          const key = `${b.id}:${c.driver_id}`;
                          if (hasPickup && hasDriver) {
                            const cached = etaCache[key];
                            if (cached) label = `${c.name ?? c.driver_id.slice(0, 8)}${c.busy ? " • busy" : ""} • ${cached}`;
                            else {
                              (async () => {
                                const eta = await roadEta(c.lat as number, c.lng as number, b.pickup_lat as number, b.pickup_lng as number);
                                if (eta) {
                                  const pretty = eta.minutes != null ? `~${eta.minutes}m` : eta.km != null ? `${eta.km}km` : "—";
                                  setEtaCache((prev) => (prev[key] ? prev : { ...prev, [key]: pretty }));
                                }
                              })();
                            }
                          }
                          return (
                            <option key={c.driver_id} value={c.driver_id} disabled={c.busy} title={c.busy ? "Busy" : ""}>
                              {label}
                            </option>
                          );
                        })}
                      </select>

                      <button
                        onClick={() => handleAssign(b.id)}
                        disabled={!canAssign(b) ||
                                  !selected ||
                                  (candidatesByBooking[b.id]?.find((c) => c.driver_id === selected)?.busy ?? false) ||
                                  assigningId === b.id}
                        className={"px-3 py-1 rounded text-sm text-white " +
                          (assigningId === b.id || !canAssign(b) || !selected ? "bg-gray-400" : "bg-black")}
                      >
                        {assigningId === b.id ? "Assigning…" : "Assign"}
                      </button>

                      <button onClick={() => setStatus(b.id, "en_route")} disabled={b.status !== "assigned"} className={"px-3 py-1 rounded text-sm " + (b.status === "assigned" ? "bg-white border" : "bg-gray-100 text-gray-400")}>En-route</button>
                      <button onClick={() => setStatus(b.id, "arrived")}  disabled={b.status !== "en_route"} className={"px-3 py-1 rounded text-sm " + (b.status === "en_route" ? "bg-white border" : "bg-gray-100 text-gray-400")}>Arrived</button>
                      <button onClick={() => setStatus(b.id, "completed")} disabled={b.status !== "arrived"} className={"px-3 py-1 rounded text-sm " + (b.status === "arrived" ? "bg-white border" : "bg-gray-100 text-gray-400")}>Complete</button>

                      {b.pickup_town && b.status === "pending" && (
                        <div className="mt-2 p-2 border rounded bg-gray-50">
                          <div className="text-xs font-semibold mb-1">Admin override (any town)</div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <select
                              className="border rounded px-2 py-1"
                              value={overrideSelected}
                              onChange={(e) => setOverrideDriverByBooking((p) => ({ ...p, [b.id]: e.target.value }))}
                            >
                              <option value="">Pick any driver (override)</option>
                              {drivers.filter((d) => (onlineOnly ? d.online : true)).map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name ?? d.id} {d.town ? `• ${d.town}` : ""} {!d.online ? "• offline" : ""}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => handleAssignOverride(b.id)}
                              disabled={!overrideSelected || assigningId === b.id}
                              className={"px-3 py-1 rounded text-sm text-white " + (!overrideSelected || assigningId === b.id ? "bg-gray-400" : "bg-black")}
                              title="Requires reason; audited"
                            >
                              {assigningId === b.id ? "Overriding…" : "Override assign"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <datalist id="dispatch
<EnvGuard />-towns">{townList.map((t) => <option key={t} value={t} />)}</datalist>

      {/* Map modal */}
      <PickupMapModal
        isOpen={!!mapOpenFor}
        initial={mapInitial ?? undefined}
        onClose={() => setMapOpenFor(null)}
        onSave={(pos) => pos && savePickupFromModal(pos.lat, pos.lng)}
      />

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className="bg-black text-white rounded px-3 py-2 shadow">
            <div className="font-semibold">{t.title}</div>
            {t.description && <div className="text-xs opacity-80">{t.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}




