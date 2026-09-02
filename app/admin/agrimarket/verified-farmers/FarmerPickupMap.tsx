"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { FormEvent, useEffect, useRef, useState } from "react";

export type FarmerPickupPin = {
  lat: number | null;
  lng: number | null;
  resolved_town: string | null;
  resolved_barangay: string | null;
  resolved_label: string | null;
  launch_eligible: boolean;
  resolving: boolean;
};

type SearchResult = {
  lat: number;
  lng: number;
  town: string;
  barangay: string | null;
  label: string;
  launch_eligible: boolean;
};

type Props = {
  selectedTown: string;
  value: FarmerPickupPin;
  onChange: (value: FarmerPickupPin) => void;
};

const MAPBOX_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
  "";
mapboxgl.accessToken = MAPBOX_TOKEN;

const DEFAULT_CENTER: [number, number] = [121.11, 16.8219];

export default function FarmerPickupMap({ selectedTown, value, onChange }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const [mapError, setMapError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  async function resolvePin(lat: number, lng: number) {
    onChangeRef.current({
      lat,
      lng,
      resolved_town: null,
      resolved_barangay: null,
      resolved_label: null,
      launch_eligible: false,
      resolving: true,
    });

    try {
      const response = await fetch(
        `/api/agrimarket/admin/farmer-location?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
        { cache: "no-store" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false || !payload?.location) {
        onChangeRef.current({
          lat,
          lng,
          resolved_town: null,
          resolved_barangay: null,
          resolved_label: null,
          launch_eligible: false,
          resolving: false,
        });
        setMapError(
          payload?.message ||
            payload?.error ||
            "JRide could not verify this pickup pin. Move it to the exact farm or roadside pickup point."
        );
        return;
      }

      const location = payload.location;
      onChangeRef.current({
        lat,
        lng,
        resolved_town: String(location.town || "") || null,
        resolved_barangay: String(location.barangay || "") || null,
        resolved_label: String(location.label || "") || null,
        launch_eligible: location.launch_eligible === true,
        resolving: false,
      });
      setMapError("");
    } catch {
      onChangeRef.current({
        lat,
        lng,
        resolved_town: null,
        resolved_barangay: null,
        resolved_label: null,
        launch_eligible: false,
        resolving: false,
      });
      setMapError("The map location service is unavailable. Farmer account creation is blocked until the pin can be verified.");
    }
  }

  function setMarker(lng: number, lat: number, resolve = true) {
    const map = mapRef.current;
    if (!map) return;

    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
      markerRef.current.on("dragend", () => {
        const position = markerRef.current?.getLngLat();
        if (position) void resolvePin(position.lat, position.lng);
      });
    } else {
      markerRef.current.setLngLat([lng, lat]);
    }

    map.flyTo({ center: [lng, lat], zoom: Math.max(Number(map.getZoom?.() || 0), 15) });
    if (resolve) void resolvePin(lat, lng);
  }

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    if (!MAPBOX_TOKEN) {
      setMapError("The Mapbox browser token is missing. Farmer provisioning is blocked until the map is configured.");
      return;
    }

    try {
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center: DEFAULT_CENTER,
        zoom: 9,
      });
      map.addControl(new mapboxgl.NavigationControl(), "top-right");
      map.on("click", (event: any) => {
        setMarker(event.lngLat.lng, event.lngLat.lat, true);
      });
      mapRef.current = map;
      if (value.lat != null && value.lng != null) {
        setMarker(value.lng, value.lat, false);
      }
    } catch (error: any) {
      setMapError(String(error?.message || "Unable to load the location map."));
    }

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (value.lat == null || value.lng == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (mapRef.current) setMarker(value.lng, value.lat, false);
  }, [value.lat, value.lng]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchError("Enter a barangay, landmark, road, or place name.");
      return;
    }

    setSearching(true);
    setSearchError("");
    setSearchResults([]);
    try {
      const response = await fetch(
        `/api/agrimarket/admin/farmer-location?q=${encodeURIComponent(query)}`,
        { cache: "no-store" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        setSearchError(payload?.message || payload?.error || "Location search failed.");
      } else {
        const results = Array.isArray(payload?.results) ? payload.results : [];
        setSearchResults(results);
        if (!results.length) {
          setSearchError("No launch-area result matched. Add the town name and Ifugao to the search, or use the map directly.");
        }
      }
    } catch {
      setSearchError("Location search is temporarily unavailable.");
    } finally {
      setSearching(false);
    }
  }

  function useCurrentLocation() {
    setMapError("");
    if (!navigator.geolocation) {
      setMapError("This browser cannot read the current location.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMarker(position.coords.longitude, position.coords.latitude, true);
      },
      (error) => {
        setMapError(error.message || "Current location permission was denied or unavailable.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  const townMatches =
    Boolean(selectedTown) &&
    Boolean(value.resolved_town) &&
    selectedTown === value.resolved_town;

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Verified private pickup pin</p>
          <h3 className="mt-1 text-lg font-bold text-blue-950">Search, tap, or drag the pin to the exact pickup point</h3>
          <p className="mt-1 text-xs text-blue-900">The pin is private. Customers never receive the coordinates or the farmer's real pickup address.</p>
        </div>
        <button
          type="button"
          onClick={useCurrentLocation}
          className="rounded-xl bg-blue-800 px-4 py-2 text-sm font-semibold text-white"
        >
          Use my current location
        </button>
      </div>

      <form onSubmit={search} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-3 text-sm"
          placeholder="Search barangay, landmark, road, or place in Ifugao"
          maxLength={180}
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded-xl border border-blue-300 bg-white px-5 py-3 text-sm font-bold text-blue-900 disabled:text-slate-400"
        >
          {searching ? "Searching..." : "Search map"}
        </button>
      </form>

      {searchError ? <p className="mt-2 text-sm text-amber-800">{searchError}</p> : null}
      {searchResults.length ? (
        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border bg-white p-2">
          {searchResults.map((result) => (
            <button
              key={`${result.lat}:${result.lng}:${result.label}`}
              type="button"
              onClick={() => {
                setMarker(result.lng, result.lat, true);
                setSearchResults([]);
                setSearchQuery(result.label);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-blue-50"
            >
              <span className="block text-sm font-semibold text-slate-900">{result.label}</span>
              <span className="block text-xs text-slate-500">{result.barangay ? `${result.barangay}, ` : ""}{result.town}, Ifugao</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 h-[360px] overflow-hidden rounded-2xl border bg-slate-100">
        <div ref={mapContainerRef} className="h-full w-full" />
      </div>
      <p className="mt-2 text-xs text-blue-900">Tap the road-accessible pickup point. Drag the marker for fine adjustment, then wait for JRide to verify the municipality.</p>

      {mapError ? <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{mapError}</div> : null}
      {value.resolving ? <div className="mt-3 rounded-xl bg-white p-3 text-sm text-blue-900">Verifying the pickup municipality...</div> : null}

      {value.lat != null && value.lng != null && !value.resolving ? (
        <div className={`mt-3 rounded-xl p-4 text-sm ${townMatches && value.launch_eligible ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950"}`}>
          <p className="font-bold">
            {townMatches && value.launch_eligible
              ? `Pin verified: ${value.resolved_barangay ? `${value.resolved_barangay}, ` : ""}${value.resolved_town}, Ifugao`
              : value.resolved_town
                ? `Pin resolves to ${value.resolved_barangay ? `${value.resolved_barangay}, ` : ""}${value.resolved_town}, not the selected municipality.`
                : "This pin has not been verified as an Ifugao launch location."}
          </p>
          {value.resolved_label ? <p className="mt-1 text-xs">Map result: {value.resolved_label}</p> : null}
          <p className="mt-1 font-mono text-xs">{value.lat.toFixed(6)}, {value.lng.toFixed(6)}</p>
          {!value.launch_eligible && value.resolved_town ? (
            <p className="mt-2 text-xs">That municipality is not yet enabled for farmer provisioning.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
