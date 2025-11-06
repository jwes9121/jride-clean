"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Ride = {
  id: string; status: string; driver_id: string | null;
  pickup_lat: number; pickup_lng: number; town?: string | null;
};
type DriverLoc = { driver_id: string; lat: number; lng: number };

export default function TrackRidePage({ params }: { params: { rideId: string } }) {
  const rideId = params.rideId;
  const sb = supabaseBrowser;
  const [ride, setRide] = useState<Ride | null>(null);
  const [driver, setDriver] = useState<DriverLoc | null>(null);

  useEffect(() => {
    let ch: any;

    async function loadRide() {
      const { data } = await sb.from("rides").select("*").eq("id", rideId).maybeSingle();
      if (data) setRide(data as Ride);
    }

    loadRide().then(() => {
      ch = sb.channel("track_ride_" + rideId)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "rides", filter: `id=eq.${rideId}` },
          (payload) => setRide(payload.new as Ride)
        )
        .subscribe();
    });

    return () => { ch && sb.removeChannel(ch); };
  }, [rideId, sb]);

  useEffect(() => {
    if (!ride?.driver_id) return;
    const ch = sb.channel("track_driver_" + ride.driver_id)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "driver_locations", filter: `driver_id=eq.${ride.driver_id}` },
        (p) => {
          const d = p.new as any;
          if (d?.lat && d?.lng) setDriver({ driver_id: d.driver_id, lat: d.lat, lng: d.lng });
        })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [ride?.driver_id, sb]);

  return (
    <div className="p-6 space-y-3 max-w-xl">
      <h1 className="text-xl font-semibold">Track JRide</h1>
      <div>Ride: <b>{rideId}</b></div>
      <div>Status: <b>{ride?.status ?? "loading..."}</b></div>
      <div>Driver: <b>{ride?.driver_id ?? "(unassigned)"}</b></div>
      {driver ? (
        <div className="text-sm">Driver location: {driver.lat.toFixed(5)}, {driver.lng.toFixed(5)}</div>
      ) : (
        <div className="text-sm opacity-70">Waiting for driver location…</div>
      )}
      <div className="text-xs opacity-60">(Map optional; values update live.)</div>
    </div>
  );
}
