"use client";
import { useMemo } from "react";
import type { LiveDriver } from "@/types/driver";

function timeAgo(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

type Props = {
  drivers: Record<string, LiveDriver>;
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
};

export default function LiveDriverSidebar({ drivers, selectedId, onSelect }: Props) {
  const rows = useMemo(
    () =>
      Object.values(drivers)
        .sort((a, b) => (a.updated_at > b.updated_at ? -1 : 1))
        .slice(0, 200),
    [drivers]
  );

  return (
    <aside className="w-full md:w-[360px] xl:w-[420px] max-h-[70vh] overflow-auto rounded-2xl border bg-white">
      <div className="sticky top-0 z-10 px-3 py-2 border-b bg-white/95 backdrop-blur-sm">
        <div className="text-sm font-medium">Online Drivers</div>
      </div>
      <ul className="divide-y">
        {rows.map((d) => {
          const isSel = d.driver_id === selectedId;
          return (
            <li
              key={d.driver_id}
              className={`px-3 py-2 text-sm cursor-pointer ${isSel ? "bg-blue-50" : "hover:bg-gray-50"}`}
              onClick={() => onSelect(isSel ? null : d.driver_id)}
              title={`${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold truncate">
                  {d.name?.trim() || d.driver_id.slice(0, 8)}
                </div>
                <div className="text-xs text-gray-500">{timeAgo(d.updated_at)}</div>
              </div>
              <div className="text-xs text-gray-600">
                {typeof d.speed === "number" ? `${d.speed.toFixed(1)} km/h` : "—"}{" "}
                {d.town ? `• ${d.town}` : ""}
              </div>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="px-3 py-6 text-sm text-gray-500">No drivers yet.</li>
        )}
      </ul>
    </aside>
  );
}
