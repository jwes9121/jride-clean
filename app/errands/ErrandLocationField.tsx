"use client";

import * as React from "react";

export type ErrandLocationValue = {
  label: string;
  lat: number;
  lng: number;
};

type Suggestion = {
  id: string;
  label: string;
  center?: [number, number];
};

type Props = {
  title: string;
  value: ErrandLocationValue | null;
  onChange: (value: ErrandLocationValue) => void;
  placeholder?: string;
  proximity?: { lat: number; lng: number } | null;
  allowCurrentLocation?: boolean;
  helpText?: string;
};

const LAST_STAGE0_KEY = "jride_errand_last_stage0_v1";
const MAX_MOBILE_GPS_ACCURACY_METERS = 2000;
const MAX_LAST_PIN_DISTANCE_KM = 50;

function text(value: unknown): string {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean.toLowerCase() === "null" || clean.toLowerCase() === "undefined"
    ? ""
    : clean;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function haversineKm(a: ErrandLocationValue, b: { lat: number; lng: number }): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function loadLastStage0(): ErrandLocationValue | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_STAGE0_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const label = text(parsed?.label);
    const lat = finite(parsed?.lat);
    const lng = finite(parsed?.lng);
    if (!label || lat == null || lng == null) return null;
    return { label, lat, lng };
  } catch {
    return null;
  }
}

function saveLastStage0(value: ErrandLocationValue) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      LAST_STAGE0_KEY,
      JSON.stringify({ label: value.label, lat: value.lat, lng: value.lng })
    );
  } catch {}
}

export default function ErrandLocationField({
  title,
  value,
  onChange,
  placeholder = "Search location",
  proximity,
  allowCurrentLocation = false,
  helpText,
}: Props) {
  const MAPBOX_TOKEN = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
    "") as string;

  const [query, setQuery] = React.useState(value?.label || "");
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const [error, setError] = React.useState("");
  const [mapOpen, setMapOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ErrandLocationValue | null>(value);
  const [lastStage0, setLastStage0] = React.useState<ErrandLocationValue | null>(null);
  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);
  const mapboxRef = React.useRef<any>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = React.useRef("");

  if (!sessionTokenRef.current) {
    sessionTokenRef.current = `err_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }

  React.useEffect(() => {
    if (value?.label && value.label !== query) setQuery(value.label);
  }, [value?.label]);

  React.useEffect(() => {
    if (allowCurrentLocation) setLastStage0(loadLastStage0());
  }, [allowCurrentLocation]);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try {
        mapRef.current?.remove?.();
      } catch {}
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  function commit(next: ErrandLocationValue) {
    setQuery(next.label);
    setDraft(next);
    setSuggestions([]);
    if (allowCurrentLocation) {
      saveLastStage0(next);
      setLastStage0(next);
    }
    onChange(next);
  }

  async function retrieve(mapboxId: string): Promise<Suggestion | null> {
    if (!MAPBOX_TOKEN || !mapboxId) return null;
    try {
      const url =
        "https://api.mapbox.com/search/searchbox/v1/retrieve/" +
        encodeURIComponent(mapboxId) +
        `?session_token=${encodeURIComponent(sessionTokenRef.current)}` +
        `&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
      const response = await fetch(url, { cache: "no-store" });
      const json: any = await response.json().catch(() => ({}));
      const feature = json?.features?.[0];
      const coords = feature?.geometry?.coordinates;
      if (!response.ok || !Array.isArray(coords) || coords.length < 2) return null;
      const lng = finite(coords[0]);
      const lat = finite(coords[1]);
      if (lat == null || lng == null) return null;
      return {
        id: mapboxId,
        label: text(
          feature?.properties?.full_address ||
            feature?.properties?.place_formatted ||
            feature?.properties?.name
        ),
        center: [lng, lat],
      };
    } catch {
      return null;
    }
  }

  async function reverseGeocode(lng: number, lat: number): Promise<string> {
    if (!MAPBOX_TOKEN) return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    try {
      const url =
        "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
        encodeURIComponent(`${lng},${lat}`) +
        `.json?limit=1&country=PH&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
      const response = await fetch(url, { cache: "no-store" });
      const json: any = await response.json().catch(() => ({}));
      return text(json?.features?.[0]?.place_name) || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  }

  async function runSearch(nextQuery: string) {
    const clean = text(nextQuery);
    if (!clean || clean.length < 2) {
      setSuggestions([]);
      return;
    }
    if (!MAPBOX_TOKEN) {
      setError("Map search is unavailable because the Mapbox token is missing.");
      return;
    }

    setSearching(true);
    setError("");
    try {
      const prox = proximity
        ? `&proximity=${encodeURIComponent(`${proximity.lng},${proximity.lat}`)}`
        : "";
      const url =
        "https://api.mapbox.com/search/searchbox/v1/suggest" +
        `?q=${encodeURIComponent(clean)}` +
        "&limit=6&country=PH&language=en&types=poi,address,place" +
        prox +
        `&session_token=${encodeURIComponent(sessionTokenRef.current)}` +
        `&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
      const response = await fetch(url, { cache: "no-store" });
      const json: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Location search failed.");
      const rows = Array.isArray(json?.suggestions) ? json.suggestions : [];
      setSuggestions(
        rows
          .map((row: any) => ({
            id: text(row?.mapbox_id || row?.id),
            label: text(
              row?.full_address ||
                row?.place_formatted ||
                [row?.name, row?.place_formatted].filter(Boolean).join(", ") ||
                row?.name
            ),
          }))
          .filter((row: Suggestion) => row.id && row.label)
      );
    } catch (err: any) {
      setSuggestions([]);
      setError(text(err?.message) || "Location search failed.");
    } finally {
      setSearching(false);
    }
  }

  function scheduleSearch(nextQuery: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(nextQuery), 350);
  }

  async function chooseSuggestion(suggestion: Suggestion) {
    setError("");
    let selected = suggestion;
    if (!selected.center) {
      const full = await retrieve(selected.id);
      if (!full?.center) {
        setError("Could not resolve that location. Please pick it on the map.");
        return;
      }
      selected = full;
    }
    const lng = finite(selected.center?.[0]);
    const lat = finite(selected.center?.[1]);
    if (lat == null || lng == null) return;
    commit({ label: selected.label, lat, lng });
  }

  async function useCurrentLocation() {
    setError("");

    if (!isMobileDevice()) {
      setError(
        "Desktop location can be inaccurate and may point to Manila. Search your Stage 0 place, or use the last Stage 0 pin."
      );
      return;
    }

    const geo = typeof navigator !== "undefined" ? navigator.geolocation : null;
    if (!geo?.getCurrentPosition) {
      setError("Location is not available on this device.");
      return;
    }

    setLocating(true);
    geo.getCurrentPosition(
      async (position) => {
        const lat = finite(position.coords.latitude);
        const lng = finite(position.coords.longitude);
        const accuracy = finite(position.coords.accuracy);
        if (lat == null || lng == null) {
          setError("Could not read your location.");
          setLocating(false);
          return;
        }
        if (accuracy != null && accuracy > MAX_MOBILE_GPS_ACCURACY_METERS) {
          setError(
            `Current location is too approximate (${Math.ceil(accuracy / 1000)} km). Wait for GPS or search the meeting place.`
          );
          setLocating(false);
          return;
        }
        if (
          lastStage0 &&
          haversineKm(lastStage0, { lat, lng }) > MAX_LAST_PIN_DISTANCE_KM
        ) {
          setError(
            "The device location is far from your last Stage 0 pin. JRide did not move the pin; search the correct place or use the last pin."
          );
          setLocating(false);
          return;
        }
        const label = await reverseGeocode(lng, lat);
        commit({ label, lat, lng });
        setLocating(false);
      },
      (err) => {
        setError(
          Number(err?.code) === 1
            ? "Location permission was denied."
            : text(err?.message) || "Could not read your location."
        );
        setLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      }
    );
  }

  function openMap() {
    setError("");
    const saved = allowCurrentLocation ? lastStage0 || loadLastStage0() : null;
    const initial =
      value ||
      saved ||
      (proximity
        ? { label: "Map pin", lat: proximity.lat, lng: proximity.lng }
        : null);

    if (!initial) {
      setError(
        "Search the meeting place or tap Use my current location first. JRide will not guess your town."
      );
      return;
    }

    setDraft(initial);
    setMapOpen(true);
  }

  React.useEffect(() => {
    if (!mapOpen || !mapDivRef.current || !MAPBOX_TOKEN || !draft) return;
    let cancelled = false;

    (async () => {
      try {
        if (!mapboxRef.current) mapboxRef.current = await import("mapbox-gl");
        if (cancelled || !mapDivRef.current || !draft) return;
        const MapboxGL = mapboxRef.current.default || mapboxRef.current;
        MapboxGL.accessToken = MAPBOX_TOKEN;

        if (mapRef.current) {
          try {
            mapRef.current.remove();
          } catch {}
        }

        mapRef.current = new MapboxGL.Map({
          container: mapDivRef.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [draft.lng, draft.lat],
          zoom: 14,
        });
        mapRef.current.addControl(new MapboxGL.NavigationControl(), "top-right");
        markerRef.current = new MapboxGL.Marker({ color: "#059669" })
          .setLngLat([draft.lng, draft.lat])
          .addTo(mapRef.current);

        mapRef.current.on("click", async (event: any) => {
          const lng = finite(event?.lngLat?.lng);
          const lat = finite(event?.lngLat?.lat);
          if (lat == null || lng == null) return;
          markerRef.current?.setLngLat?.([lng, lat]);
          const label = await reverseGeocode(lng, lat);
          setDraft({ label, lat, lng });
        });
      } catch {
        setError("Map picker failed to load.");
      }
    })();

    return () => {
      cancelled = true;
      try {
        mapRef.current?.remove?.();
      } catch {}
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [mapOpen, MAPBOX_TOKEN]);

  function confirmMapPin() {
    if (!draft) return;
    commit(draft);
    setMapOpen(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-slate-700">{title}</label>
        {value ? (
          <span className="text-[11px] font-medium text-emerald-700">Pin set</span>
        ) : null}
      </div>

      <div className="relative">
        <input
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            scheduleSearch(next);
          }}
          onFocus={() => scheduleSearch(query)}
          placeholder={placeholder}
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 pr-24 text-sm shadow-sm outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
        />
        <button
          type="button"
          onClick={openMap}
          className="absolute right-2 top-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          Map
        </button>

        {suggestions.length > 0 ? (
          <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseSuggestion(suggestion)}
                className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {allowCurrentLocation ? (
          <button
            type="button"
            onClick={useCurrentLocation}
            disabled={locating}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
          >
            {locating ? "Locating..." : "Use my current location"}
          </button>
        ) : null}
        {allowCurrentLocation && lastStage0 ? (
          <button
            type="button"
            onClick={() => commit(lastStage0)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Use last Stage 0
          </button>
        ) : null}
        {searching ? <span className="text-xs text-slate-500">Searching...</span> : null}
        {value ? (
          <span className="text-[11px] text-slate-500">
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </span>
        ) : null}
      </div>

      {allowCurrentLocation && lastStage0 && !value ? (
        <div className="text-[11px] text-slate-500">
          Map will open at your last Stage 0 pin: {lastStage0.label}
        </div>
      ) : null}
      {helpText ? <div className="text-[11px] text-slate-500">{helpText}</div> : null}
      {error ? <div className="text-xs font-medium text-red-600">{error}</div> : null}

      {mapOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
          <div className="w-full max-w-2xl rounded-[28px] bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">Set {title}</div>
                <div className="text-xs text-slate-500">Tap the map to move the pin.</div>
              </div>
              <button
                type="button"
                onClick={() => setMapOpen(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
              >
                Close
              </button>
            </div>

            {MAPBOX_TOKEN ? (
              <div ref={mapDivRef} className="mt-3 h-[55vh] min-h-[320px] w-full rounded-2xl bg-slate-100" />
            ) : (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Mapbox token is unavailable.
              </div>
            )}

            <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
              {draft?.label || "Move the pin to select a location."}
            </div>

            <button
              type="button"
              onClick={confirmMapPin}
              disabled={!draft}
              className="mt-3 w-full rounded-2xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
            >
              Use this pin
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
