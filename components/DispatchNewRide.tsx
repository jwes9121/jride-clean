// components/DispatchNewRide.tsx
"use client";

import { useState } from "react";

type Props = {
  onSaved?: () => void;   // call to refresh grids after success
};

export default function DispatchNewRide({ onSaved }: Props) {
  const [form, setForm] = useState({
    passenger_name: "",
    passenger_phone: "",
    pickup_address: "",
    pickup_lat: "",
    pickup_lng: "",
    destination_address: "",
    destination_lat: "",
    destination_lng: "",
    town_hint: "",
    max_km: "5",
    freshness_mins: "5",
  });

  const [busy, setBusy] = useState<null | "save" | "assign">(null);
  const [msg, setMsg] = useState<string>("");

  function upd<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function post(url: string, body: any) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Request failed");
    return json;
  }

  async function handleSave() {
    setMsg("");
    setBusy("save");
    try {
      const payload = {
        passenger_name: form.passenger_name || null,
        passenger_phone: form.passenger_phone || null,
        pickup_address: form.pickup_address || null,
        pickup_lat: Number(form.pickup_lat),
        pickup_lng: Number(form.pickup_lng),
        destination_address: form.destination_address || null,
        destination_lat: form.destination_lat ? Number(form.destination_lat) : null,
        destination_lng: form.destination_lng ? Number(form.destination_lng) : null,
        town_hint: form.town_hint || null,
      };
      const res = await post("/api/rides/new", payload);
      setMsg(`Saved ride ${res.ride?.id ?? ""} (unassigned).`);
      onSaved?.();
    } catch (e: any) {
      setMsg(`Save failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveAssign() {
    setMsg("");
    setBusy("assign");
    try {
      const payload = {
        passenger_name: form.passenger_name || null,
        passenger_phone: form.passenger_phone || null,
        pickup_address: form.pickup_address || null,
        pickup_lat: Number(form.pickup_lat),
        pickup_lng: Number(form.pickup_lng),
        destination_address: form.destination_address || null,
        destination_lat: form.destination_lat ? Number(form.destination_lat) : null,
        destination_lng: form.destination_lng ? Number(form.destination_lng) : null,
        town_hint: form.town_hint || null,
        max_km: Number(form.max_km || "5"),
        freshness_mins: Number(form.freshness_mins || "5"),
      };
      const res = await post("/api/rides/save-assign", payload);

      if (res.assigned_driver) {
        setMsg(`Ride ${res.ride_id} assigned to driver ${res.assigned_driver}.`);
      } else {
        const note = res?.note ? ` (${res.note})` : "";
        setMsg(`Saved ride ${res.ride_id}. No nearby driver found${note}.`);
      }
      onSaved?.();
    } catch (e: any) {
      setMsg(`Save & assign failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 rounded-2xl shadow border space-y-3">
      <h3 className="text-lg font-semibold">New Ride</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input className="border p-2 rounded" placeholder="Passenger name"
          value={form.passenger_name} onChange={e=>upd("passenger_name", e.target.value)} />
        <input className="border p-2 rounded" placeholder="Passenger phone"
          value={form.passenger_phone} onChange={e=>upd("passenger_phone", e.target.value)} />

        <input className="border p-2 rounded md:col-span-2" placeholder="Pickup address"
          value={form.pickup_address} onChange={e=>upd("pickup_address", e.target.value)} />

        <input className="border p-2 rounded" placeholder="Pickup lat"
          value={form.pickup_lat} onChange={e=>upd("pickup_lat", e.target.value)} />
        <input className="border p-2 rounded" placeholder="Pickup lng"
          value={form.pickup_lng} onChange={e=>upd("pickup_lng", e.target.value)} />

        <input className="border p-2 rounded md:col-span-2" placeholder="Destination address"
          value={form.destination_address} onChange={e=>upd("destination_address", e.target.value)} />
        <input className="border p-2 rounded" placeholder="Destination lat"
          value={form.destination_lat} onChange={e=>upd("destination_lat", e.target.value)} />
        <input className="border p-2 rounded" placeholder="Destination lng"
          value={form.destination_lng} onChange={e=>upd("destination_lng", e.target.value)} />

        <input className="border p-2 rounded" placeholder="Town hint (optional)"
          value={form.town_hint} onChange={e=>upd("town_hint", e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="border p-2 rounded" placeholder="Max km (default 5)"
            value={form.max_km} onChange={e=>upd("max_km", e.target.value)} />
          <input className="border p-2 rounded" placeholder="Freshness mins (default 5)"
            value={form.freshness_mins} onChange={e=>upd("freshness_mins", e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={busy !== null}
          className="px-4 py-2 rounded-2xl shadow border disabled:opacity-50"
        >
          {busy === "save" ? "Saving..." : "Save new ride"}
        </button>

        <button
          onClick={handleSaveAssign}
          disabled={busy !== null}
          className="px-4 py-2 rounded-2xl shadow border disabled:opacity-50"
        >
          {busy === "assign" ? "Saving & assigning..." : "Save & assign nearest"}
        </button>
      </div>

      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
