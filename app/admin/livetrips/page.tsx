"use client";
import React, { useEffect, useMemo, useState } from "react";
import type { DriverLocation, Ride } from "@/types";
import LiveTripsHeader from "@/components/realtime/LiveTripsHeader";
import { DriverPanel, RidePanel } from "@/components/realtime/Panels";
import LiveDriverMap from "@/components/maps/LiveDriverMap";
import {
  fetchActiveRides,
  fetchInitialDriverLocations,
  subscribeDriverLocations,
  subscribeRides,
} from "@/components/realtime/supabaseRealtime";
import { ToastProvider, useToast } from "@/components/ui/Toast";

function PageInner() {
  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [d0, r0] = await Promise.all([
        fetchInitialDriverLocations(),
        fetchActiveRides(),
      ]);
      if (!mounted) return;
      setDrivers(d0);
      setRides(r0);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const un = subscribeDriverLocations((evt) => {
      setDrivers((prev) => {
        if (evt.type === "DELETE" && evt.old) return prev.filter((d) => d.id !== evt.old!.id);
        if (evt.new) {
          const next = [...prev];
          const i = next.findIndex((d) => d.id === evt.new!.id);
          if (i >= 0) next[i] = { ...(next[i] as any), ...(evt.new as any) };
          else next.unshift(evt.new as any);
          return next;
        }
        return prev;
      });
    });
    return () => un();
  }, []);

  useEffect(() => {
    const un = subscribeRides((evt) => {
      setRides((prev) => {
        if (evt.type === "DELETE" && evt.old) return prev.filter((r) => r.id !== evt.old!.id);
        if (evt.new) {
          const next = [...prev];
          const i = next.findIndex((r) => r.id === evt.new!.id);
          if (i >= 0) next[i] = { ...(next[i] as any), ...(evt.new as any) };
          else next.unshift(evt.new as any);
          return next;
        }
        return prev;
      });
    });
    return () => un();
  }, []);

  const driversOnline = useMemo(
    () => drivers.filter((d) => d.status === "online").length,
    [drivers]
  );

  async function handleRefresh() {
    const [d0, r0] = await Promise.all([
      fetchInitialDriverLocations(),
      fetchActiveRides(),
    ]);
    setDrivers(d0);
    setRides(r0);
    toast({ type: "info", message: "Refreshed live data." });
  }

  async function handleAssignNearest(rideId: string) {
    setSelectedRideId(rideId);
    try {
      const res = await fetch("/api/rides/assign-nearest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideId }),
      });
      if (!res.ok) {
        const msg = await res.text();
        toast({ type: "error", title: "Assign failed", message: msg.slice(0, 160) });
        return;
      }
      const j = await res.json();
      toast({
        type: "success",
        title: "Assign triggered",
        message: j?.message ?? "Nearest driver assignment attempted.",
      });
      const r0 = await fetchActiveRides();
      setRides(r0);
    } catch (e: any) {
      toast({ type: "error", title: "Assign error", message: String(e?.message ?? e) });
    }
  }

  return (
    <div className="p-4 space-y-4">
      <LiveTripsHeader
        onRefresh={handleRefresh}
        ridesCount={rides.length}
        driversOnline={driversOnline}
        driversTotal={drivers.length}
      />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 h-[520px]">
          <div className="h-full rounded-2xl overflow-hidden bg-white shadow">
            <LiveDriverMap drivers={drivers} />
          </div>
        </div>
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <DriverPanel drivers={drivers} />
          <RidePanel
            rides={rides}
            onAssignNearest={handleAssignNearest}
            selectedRideId={selectedRideId ?? undefined}
            onSelect={setSelectedRideId}
          />
        </div>
      </div>
    </div>
  );
}

export default function LiveTripsPage() {
  return (
    <ToastProvider>
      <PageInner />
    </ToastProvider>
  );
}
