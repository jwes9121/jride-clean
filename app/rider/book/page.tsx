"use client";
import { useState } from "react";

export default function RiderBookPage() {
  const [lat, setLat] = useState<number | "">("");
  const [lng, setLng] = useState<number | "">("");
  const [town, setTown] = useState("Lagawe");
  const [rideId, setRideId] = useState<string>("");

  async function useMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(6)));
        setLng(Number(pos.coords.longitude.toFixed(6)));
      },
      (err) => alert(err.message),
      { enableHighAccuracy: true }
    );
  }

  async function createRide() {
    if (lat === "" || lng === "") return alert("Pick a location or use GPS.");
    const res = await fetch("/api/rides/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pickup_lat: Number(lat), pickup_lng: Number(lng), town }),
    });
    const json = await res.json();
    if (!res.ok) return alert(json?.error || "Failed");
    setRideId(json.rideId);
  }

  return (
    <div className="p-6 max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Book a JRide</h1>

      <div className="space-y-2">
        <div className="flex gap-2">
          <input className="border rounded px-3 py-2 w-full" placeholder="Latitude"
                 value={lat} onChange={(e)=>setLat(e.target.value === "" ? "" : Number(e.target.value))}/>
          <input className="border rounded px-3 py-2 w-full" placeholder="Longitude"
                 value={lng} onChange={(e)=>setLng(e.target.value === "" ? "" : Number(e.target.value))}/>
        </div>
        <button className="border rounded px-3 py-2" onClick={useMyLocation}>Use my GPS</button>
        <input className="border rounded px-3 py-2 w-full" placeholder="Town (e.g., Lagawe)"
               value={town} onChange={(e)=>setTown(e.target.value)} />
        <button className="border rounded px-3 py-2" onClick={createRide}>Create Ride</button>
      </div>

      {rideId && (
        <div className="mt-4">
          <div>Ride created: <b>{rideId}</b></div>
          <a className="text-blue-600 underline" href={`/rider/track/${rideId}`}>Track this ride</a>
        </div>
      )}
    </div>
  );
}
