'use client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  subscribeDriverLocations,
  subscribeRides,
  fetchInitialDriverLocations,
  fetchActiveRides,
} from '@/components/realtime/supabaseRealtime';
import LiveDriverMap from '@/components/maps/LiveDriverMap';
import type { DriverLocation, Ride } from '@/types';

/** Basic filter flags for the toolbar. Extend as needed. */
type UiFlags = {
  followMode: boolean;
  hideStaleOverMeters: number | null;
};

export default function Page() {
  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [flags, setFlags] = useState<UiFlags>({ followMode: true, hideStaleOverMeters: 10 });
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Initial loads + realtime subscriptions
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [initialDrivers, activeRides] = await Promise.all([
          fetchInitialDriverLocations(),
          fetchActiveRides(),
        ]);
        if (!mounted) return;
        setDrivers(initialDrivers);
        setRides(activeRides);
      } catch {
        // swallow for now; page renders even without data
      }
    })();

    const unDrivers = subscribeDriverLocations((evt) => {
      setDrivers((prev) => {
        if (evt.type === 'DELETE' && evt.old) return prev.filter((d) => d.id !== evt.old!.id);
        if (!evt.new) return prev;
        const idx = prev.findIndex((d) => d.id === evt.new!.id);
        if (idx === -1) return [evt.new!, ...prev];
        const next = [...prev];
        next[idx] = evt.new!;
        return next;
      });
    });

    const unRides = subscribeRides((evt) => {
      setRides((prev) => {
        if (evt.type === 'DELETE' && evt.old) return prev.filter((r) => r.id !== evt.old!.id);
        if (!evt.new) return prev;
        const idx = prev.findIndex((r) => r.id === evt.new!.id);
        if (idx === -1) return [evt.new!, ...prev];
        const next = [...prev];
        next[idx] = evt.new!;
        return next;
      });
    });

    // SYNC cleanup (required by React)
    return () => {
      mounted = false;
      unDrivers();
      unRides();
    };
  }, []);

  const visibleDrivers = useMemo(() => {
    if (flags.hideStaleOverMeters == null) return drivers;
    const cutoffMs = 1000 * 60 * 60 * 3; // example: hide locations older than 3h if desired
    const now = Date.now();
    return drivers.filter((d) => {
      const t = typeof d.updated_at === 'string' ? Date.parse(d.updated_at) : (d.updated_at as unknown as number);
      if (Number.isFinite(t)) {
        if (now - t > cutoffMs) return false;
      }
      return true;
    });
  }, [drivers, flags.hideStaleOverMeters]);

  const onlineCount = visibleDrivers.length;

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50"
          onClick={() => {
            // simple fit to drivers (if your map component exposes a method)
            if ((mapRef.current as any)?.fitToDrivers) {
              (mapRef.current as any).fitToDrivers(visibleDrivers);
            }
          }}
        >
          Fit to drivers
        </button>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={flags.followMode}
            onChange={(e) => setFlags((f) => ({ ...f, followMode: e.target.checked }))}
          />
          Follow mode
        </label>

        <button
          className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50"
          onClick={() => setFlags((f) => ({ ...f, hideStaleOverMeters: null }))}
        >
          Clear selection
        </button>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!flags.hideStaleOverMeters}
            onChange={(e) =>
              setFlags((f) => ({ ...f, hideStaleOverMeters: e.target.checked ? 10 : null }))
            }
          />
          Hide stale &gt; 10m
        </label>

        <span className="ml-auto rounded-full border px-3 py-1 text-sm">
          Online Drivers: {onlineCount}
        </span>
      </div>

      <div className="grid h-full grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
        <div className="relative overflow-hidden rounded-xl border">
          {/* Your map component. It should be "use client" and accept these props. */}
          <LiveDriverMap
            ref={mapRef as any}
            drivers={visibleDrivers}
            rides={rides}
            followMode={flags.followMode}
          />
        </div>

        <aside className="flex min-h-0 flex-col gap-3 rounded-xl border p-3">
          <section>
            <h2 className="mb-1 text-sm font-semibold">Online Drivers</h2>
            {visibleDrivers.length === 0 ? (
              <p className="text-sm text-gray-500">No drivers yet.</p>
            ) : (
              <ul className="max-h-[40vh] overflow-auto text-sm">
                {visibleDrivers.map((d) => (
                  <li key={d.id} className="flex items-center justify-between border-b py-1 last:border-none">
                    <span className="truncate">{d.id}</span>
                    <span className="tabular-nums text-gray-500">
                      {typeof d.lat === 'number' && typeof d.lng === 'number'
                        ? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`
                        : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="min-h-0 flex-1">
            <h2 className="mb-1 text-sm font-semibold">Active Rides</h2>
            {rides.length === 0 ? (
              <p className="text-sm text-gray-500">No active rides.</p>
            ) : (
              <ul className="max-h-full overflow-auto text-sm">
                {rides.map((r) => (
                  <li key={r.id} className="flex items-center justify-between border-b py-1 last:border-none">
                    <div className="min-w-0">
                      <div className="truncate font-medium">#{r.id}</div>
                      <div className="truncate text-xs text-gray-500">{r.status}</div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {r.created_at ? new Date(r.created_at as any).toLocaleTimeString() : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
