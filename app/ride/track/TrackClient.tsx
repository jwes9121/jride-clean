"use client";

import React, { useEffect, useMemo, useState , useRef } from "react";

type AnyRec = Record<string, any>;

function money(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "-";
  return "PHP " + x.toFixed(0);
}

function buildStaticMapUrl(args: {
  token: string;
  
  baseUrl?: string;
pickup?: { lat: number; lng: number };
  dropoff?: { lat: number; lng: number };
  driver?: { lat: number; lng: number };
}) {
  const { token, pickup, dropoff, driver, baseUrl } = args;
  const pins: string[] = [];

  // Mapbox pin formats: pin-s / pin-l (size), +color, label
  if (pickup) pins.push(`pin-s-a+2ecc71(${pickup.lng},${pickup.lat})`);
  if (dropoff) pins.push(`pin-s-b+e74c3c(${dropoff.lng},${dropoff.lat})`);
  if (driver) {
    // Custom JRide marker icon for driver (requires PUBLIC URL reachable by Mapbox static API servers)
    // Works on production domains; localhost will fallback to default pin.
    const isLocal = (baseUrl || "").includes("localhost") || (baseUrl || "").includes("127.0.0.1");
    if (baseUrl && !isLocal) {
      const iconUrl = `${baseUrl}/markers/jrider-trike-60.png`;
      // Mapbox Static overlay supports url-<ENCODED_URL>(lon,lat)
      pins.push(`url-${encodeURIComponent(iconUrl)}(${driver.lng},${driver.lat})`);
    } else {
      // Local fallback (Mapbox cannot fetch localhost assets)
      pins.push(`pin-l-car+3b82f6(${driver.lng},${driver.lat})`);
    }
  }
  const overlay = pins.join(",");
  const base = "https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/";
  const geo = overlay ? overlay + "/auto" : "auto";
  const size = "900x520";
  return `${base}${geo}/${size}?padding=80&access_token=${encodeURIComponent(token)}`;
}

export default function TrackClient({ code }: { code: string }) {
  // JRIDE_TOKEN_DECL_BEGIN
  const token =
    (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
      "") as string;
  // JRIDE_TOKEN_DECL_END
const mapContainerRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<AnyRec | null>(null);
  const [last, setLast] = useState<string>("");

  async function refresh() {
    if (!code) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/passenger/track?booking_code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "TRACK_FAILED");
      setData(j);
      setLast(new Date().toLocaleTimeString());
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const booking = data?.booking || null;
  const dl = data?.driver_location || null;

  const pickup = useMemo(() => {
    const lat = Number(booking?.pickup_lat);
    const lng = Number(booking?.pickup_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [booking]);

  const dropoff = useMemo(() => {
    const lat = Number(booking?.dropoff_lat);
    const lng = Number(booking?.dropoff_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [booking]);

  const driver = useMemo(() => {
    const lat = Number(dl?.lat ?? dl?.latitude);
    const lng = Number(dl?.lng ?? dl?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [dl]);

  const status = String(booking?.status || "");
  const proposedFare = booking?.proposed_fare;
  const paxResp = String(booking?.passenger_fare_response || "");
  const showFarePopup = status === "fare_proposed" && proposedFare != null && paxResp.toLowerCase() !== "accepted";

  async function sendFareResponse(resp: "accepted" | "declined") {
    if (!code) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/passenger/fare-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_code: code, response: resp }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.message || j?.code || "FARE_RESPONSE_FAILED");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  const fee = Number(data?.convenience_fee ?? 15);
  const paxTotal = Number(proposedFare ?? 0) + (Number.isFinite(fee) ? fee : 15);

  const mapUrl = useMemo(() => {
    if (!token) return "";
    return buildStaticMapUrl({ token: token, pickup: pickup || undefined, dropoff: dropoff || undefined, driver: driver || undefined, baseUrl: (typeof window !== "undefined" ? window.location.origin : "") });
  }, [token, pickup, dropoff, driver]);

  function getPhase(): "to_pickup" | "to_dropoff" {
    const st = String(booking?.status || "").toLowerCase();
    // Before pickup / pre-start: guide driver to pickup (Grab/Angkas pattern)
    const toPickup = ["fare_proposed","accepted","ready","assigned","pending"].includes(st);
    if (toPickup) return "to_pickup";
    // After pickup started or moving: guide to dropoff
    return "to_dropoff";
  }

  function buildGoogleDirUrl(origin: {lat:number,lng:number}, dest: {lat:number,lng:number}) {
    return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}&travelmode=driving`;
  }

  function buildWazeUrl(origin: {lat:number,lng:number}, dest: {lat:number,lng:number}) {
    // Waze deep link: destination only is most reliable; include origin in the share text/link via Google as fallback.
    // We'll navigate to destination in Waze; for "to_pickup" destination=pickup, for "to_dropoff" destination=dropoff.
    return `https://waze.com/ul?ll=${dest.lat}%2C${dest.lng}&navigate=yes`;
  }

  function computeSmartOriginDest(): { origin: {lat:number,lng:number}, dest: {lat:number,lng:number}, phase: "to_pickup" | "to_dropoff" } | null {
    if (!pickup || !dropoff) return null;

    const phase = getPhase();

    if (phase === "to_pickup") {
      // Prefer live driver location as origin; fallback to pickup if missing
      const origin = driver ? driver : pickup;
      const dest = pickup;
      return { origin, dest, phase };
    }

    // to_dropoff
    return { origin: pickup, dest: dropoff, phase };
  }

  async function copyRouteLink() {
    const x = computeSmartOriginDest();
    if (!x) return;
    const url = buildGoogleDirUrl(x.origin, x.dest);
    try {
      await navigator.clipboard.writeText(url);
      alert("Route link copied.");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("Route link copied.");
    }
  }

  function openSmartGoogleMaps() {
    const x = computeSmartOriginDest();
    if (!x) return;
    const url = buildGoogleDirUrl(x.origin, x.dest);
    window.open(url, "_blank");
  }

  function openSmartWaze() {
    const x = computeSmartOriginDest();
    if (!x) return;
    const url = buildWazeUrl(x.origin, x.dest);
    window.open(url, "_blank");
  }

  function smartNavLabel() {
    const st = String(booking?.status || "").toLowerCase();
    const phase = getPhase();
    const suffix =
      phase === "to_pickup"
        ? "Navigate to Passenger"
        : "Navigate to Destination";
    // Small hint for passenger view
    if (st === "ready") return suffix + " (driver)";
    return suffix;
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xl font-semibold">JRide Passenger Tracking</div>
            <div className="text-sm opacity-70">Booking code: <span className="font-mono">{code || "(missing)"}</span></div>
          </div>
          <button
            className="rounded-xl border border-black/10 px-3 py-2 text-sm hover:bg-black/5"
            onClick={refresh}
            disabled={!code || loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {err ? (
          <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">Error: {err}</div>
        ) : null}

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold">Status</div>
            <div className="mt-1 text-lg">{status || "-"}</div>
            <div className="mt-1 text-xs opacity-60">Last update: {last || "-"}</div>

            <div className="mt-3 text-sm">
              <div><span className="opacity-70">Pickup:</span> {pickup ? `${pickup.lat.toFixed(6)}, ${pickup.lng.toFixed(6)}` : "-"}</div>
              <div><span className="opacity-70">Dropoff:</span> {dropoff ? `${dropoff.lat.toFixed(6)}, ${dropoff.lng.toFixed(6)}` : "-"}</div>
              <div className="mt-2"><span className="opacity-70">Driver:</span> {driver ? `${driver.lat.toFixed(6)}, ${driver.lng.toFixed(6)}` : "-"}</div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2">
              <button
                className="w-full rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={openSmartGoogleMaps}
                disabled={!pickup || !dropoff} title="Open navigation in Maps"
              >
                {smartNavLabel()}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
                  onClick={openSmartWaze}
                  disabled={!pickup || !dropoff}
                >
                  Open in Waze
                </button>

                <button
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/5 disabled:opacity-50"
                  onClick={copyRouteLink}
                  disabled={!pickup || !dropoff}
                >
                  Copy route link
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold">Map</div>
            {!token ? (
              <div className="mt-2 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-800">
                Mapbox token missing. Set <span className="font-mono">NEXT_PUBLIC_MAPBOX_TOKEN</span> (or <span className="font-mono">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</span>).
              </div>
            ) : mapUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="mt-2 w-full rounded-xl border border-black/10" src={mapUrl} alt="map" />
            ) : (
              <div className="mt-2 rounded-xl bg-black/5 p-3 text-sm">Waiting for coordinates...</div>
            )}

            <div className="mt-2 text-xs opacity-60">
              Markers: A=pickup, B=dropoff, JRider=driver

        {/* JRIDE_MAPBOX_CONTAINER_BEGIN */}
        {token ? (
          <div
            ref={mapContainerRef}
            style={{ width: "100%", height: 240, borderRadius: 12, overflow: "hidden" }}
          />
        ) : null}
        {/* JRIDE_MAPBOX_CONTAINER_END */}
 (updates every 3s).
            </div>
          </div>
        </div>
      </div>

      {showFarePopup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-lg">
            <div className="text-lg font-semibold">Fare Proposal</div>
            <div className="mt-2 text-sm">
              Proposed fare: <span className="font-semibold">{money(proposedFare)}</span><br/>
              Convenience fee: <span className="font-semibold">{money(fee)}</span><br/>
              Passenger total: <span className="font-semibold">{money(paxTotal)}</span>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="flex-1 rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => sendFareResponse("accepted")}
                disabled={loading}
              >
                OK / Proceed
              </button>
              <button
                className="flex-1 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => sendFareResponse("declined")}
                disabled={loading}
              >
                Decline / Re-route
              </button>
            </div>

            <div className="mt-2 text-xs opacity-60">
              Accept keeps status at <span className="font-mono">ready</span>. Decline clears fare so driver can propose again.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}



