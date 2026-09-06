"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { FARMER_TOWN_CENTERS } from "@/lib/agrimarket/farmer-towns";

export type FarmerPickupPin = {
  lat: number | null; lng: number | null; resolved_town: string | null;
  resolved_barangay: string | null; resolved_label: string | null;
  launch_eligible: boolean; resolving: boolean;
};
export const emptyFarmerPin = (): FarmerPickupPin => ({ lat: null, lng: null, resolved_town: null, resolved_barangay: null, resolved_label: null, launch_eligible: false, resolving: false });
type SearchResult = { lat: number; lng: number; town: string; barangay: string | null; label: string };
const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";
mapboxgl.accessToken = TOKEN;

export default function FarmerPickupMap({ selectedTown, value, onChange }: { selectedTown: string; value: FarmerPickupPin; onChange: (pin: FarmerPickupPin) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const currentTown = useRef(selectedTown);
  const generation = useRef(0);
  const searchGeneration = useRef(0);
  const previousTown = useRef(selectedTown);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function clearPin() {
    generation.current += 1;
    marker.current?.remove(); marker.current = null;
    onChangeRef.current(emptyFarmerPin());
  }

  async function placePin(lat: number, lng: number) {
    const request = ++generation.current;
    const base = { ...emptyFarmerPin(), lat, lng };
    if (!map.current) return;
    if (!marker.current) {
      marker.current = new mapboxgl.Marker({ draggable: true }).setLngLat([lng, lat]).addTo(map.current);
      marker.current?.on("dragend", () => { const point = marker.current?.getLngLat(); if (point) void placePin(point.lat, point.lng); });
    } else marker.current.setLngLat([lng, lat]);
    onChangeRef.current({ ...base, resolving: true });
    setError(""); setNotice("");
    try {
      const response = await fetch(`/api/agrimarket/farmer-location?lat=${lat}&lng=${lng}`, { cache: "no-store" });
      const payload = await response.json();
      if (generation.current !== request) return;
      if (!response.ok || !payload.location) throw new Error(payload.message || "Move the pin to a pickup point JRide can verify.");
      const location = payload.location;
      onChangeRef.current({ ...base, resolved_town: location.town, resolved_barangay: location.barangay, resolved_label: location.label, launch_eligible: location.launch_eligible === true });
    } catch (reason) {
      if (generation.current !== request) return;
      onChangeRef.current(base);
      setError(reason instanceof Error ? reason.message : "Pickup verification is unavailable. Please try again.");
    }
  }

  useEffect(() => {
    if (!container.current || !TOKEN) { setError("The pickup map is unavailable. Please try again later."); return; }
    try {
      map.current = new mapboxgl.Map({ container: container.current, style: "mapbox://styles/mapbox/streets-v12", center: FARMER_TOWN_CENTERS[selectedTown] || FARMER_TOWN_CENTERS.Lagawe, zoom: 12 });
      map.current?.addControl(new mapboxgl.NavigationControl(), "top-right");
      map.current?.on("click", (event) => { void placePin(event.lngLat.lat, event.lngLat.lng); });
    } catch { setError("The pickup map could not load. Please try again."); }
    return () => { generation.current += 1; searchGeneration.current += 1; marker.current?.remove(); marker.current = null; map.current?.remove(); map.current = null; };
    // The map instance lasts for this mounted picker; changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    currentTown.current = selectedTown;
    if (previousTown.current === selectedTown) return;
    previousTown.current = selectedTown;
    searchGeneration.current += 1;
    clearPin(); setQuery(""); setResults([]); setSearching(false); setError("");
    setNotice("Municipality changed. Place and confirm a new pickup pin.");
    map.current?.flyTo({ center: FARMER_TOWN_CENTERS[selectedTown] || FARMER_TOWN_CENTERS.Lagawe, zoom: 12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTown]);

  useEffect(() => {
    if (value.lat == null || value.lng == null) { generation.current += 1; marker.current?.remove(); marker.current = null; return; }
    if (!map.current) return;
    if (!marker.current) {
      marker.current = new mapboxgl.Marker({ draggable: true }).setLngLat([value.lng, value.lat]).addTo(map.current);
      marker.current?.on("dragend", () => { const point = marker.current?.getLngLat(); if (point) void placePin(point.lat, point.lng); });
      map.current.flyTo({ center: [value.lng, value.lat], zoom: 15 });
    } else marker.current.setLngLat([value.lng, value.lat]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.lat, value.lng]);

  async function search() {
    if (query.trim().length < 2) { setError("Enter a barangay, road or landmark."); return; }
    const request = ++searchGeneration.current;
    setSearching(true); setError(""); setResults([]);
    try {
      const params = new URLSearchParams({ q: query.trim(), town: currentTown.current });
      const response = await fetch(`/api/agrimarket/farmer-location?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (request !== searchGeneration.current) return;
      if (!response.ok) throw new Error(payload.message || "Location search is unavailable.");
      setResults(payload.results || []);
      if (!payload.results?.length) setNotice("No matching place found. You can still place the exact pickup pin on the map.");
    } catch (reason) { if (request === searchGeneration.current) setError(reason instanceof Error ? reason.message : "Location search is unavailable."); }
    finally { if (request === searchGeneration.current) setSearching(false); }
  }

  function locate() {
    if (!navigator.geolocation) { setError("This browser cannot read your location. Place the pin on the map."); return; }
    const request = generation.current;
    navigator.geolocation.getCurrentPosition((position) => {
      if (request !== generation.current) return;
      const { latitude: lat, longitude: lng } = position.coords;
      map.current?.flyTo({ center: [lng, lat], zoom: 16 });
      void placePin(lat, lng);
    }, () => { if (request === generation.current) setError("Location is unavailable. Place the pickup pin on the map."); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  }

  const matches = value.launch_eligible && value.resolved_town === selectedTown;
  return <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:col-span-2" aria-label="Private pickup map">
    <h3 className="text-lg font-bold">Where will the driver collect your products?</h3>
    <p className="mt-2 text-sm">Pin the actual handoff point, such as a farm gate or roadside meeting point. It does not have to be your home. Only the assigned driver receives this location.</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <input aria-label="Search pickup location" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder={`Barangay or landmark in ${selectedTown}`} maxLength={180} className="w-full min-w-0 rounded-xl border bg-white p-3 sm:w-auto sm:flex-1" />
      <button type="button" disabled={searching} onClick={() => void search()} className="rounded-xl border bg-white px-4 py-3 font-semibold">{searching ? "Searching…" : "Search map"}</button>
      <button type="button" onClick={locate} className="rounded-xl border bg-white px-4 py-3">Use my location</button>
    </div>
    {results.length > 0 && <div className="mt-2 max-h-48 overflow-auto rounded-xl border bg-white p-2">{results.map((result) => <button key={`${result.lat}:${result.lng}:${result.label}`} type="button" className="block w-full rounded-lg p-3 text-left hover:bg-emerald-50" onClick={() => { clearPin(); map.current?.flyTo({ center: [result.lng, result.lat], zoom: 16 }); setResults([]); setQuery(result.label); setNotice("Map moved to the search result. Tap the exact handoff point to set your pickup pin."); }}>{result.label}</button>)}</div>}
    <div ref={container} className="mt-4 h-80 overflow-hidden rounded-xl border bg-slate-100" />
    <p className="mt-2 text-xs">Search moves the map only. Tap to place your pin, or drag it to adjust.</p>
    {notice && <p className="mt-3 text-sm" role="status">{notice}</p>}
    {error && <p className="mt-3 text-sm text-red-800" role="alert">{error}</p>}
    {value.resolving && <p className="mt-3 text-sm" role="status">Checking the pickup municipality…</p>}
    {value.lat != null && !value.resolving && <p className={`mt-3 rounded-xl bg-white p-3 text-sm ${matches ? "text-emerald-900" : "text-red-800"}`} role="status">{matches ? `Pickup municipality verified: ${value.resolved_barangay ? `${value.resolved_barangay}, ` : ""}${value.resolved_town}.` : `This pin ${value.resolved_town ? `is in ${value.resolved_town}` : "could not be verified"}. Place it in ${selectedTown} before continuing.`}</p>}
  </section>;
}
