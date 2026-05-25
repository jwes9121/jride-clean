"use client";

type ActiveDriver = {
  id?: string;
  name?: string | null;
  full_name?: string | null;
  callsign?: string | null;
  municipality?: string | null;
  zone_name?: string | null;
  status?: string | null;
};

const TOWN_COLORS: Record<
  string,
  {
    badge: string;  // badge background + text/border
    dot: string;    // legend/trike base color
  }
> = {
  // OFFICIAL JRide COLORS (inter-town competitions)
  // Lagawe  - maroon         (#800000)
  // Lamut   - light yellow   (#FEF9C3 / #FACC15)
  // Kiangan - light green    (#BBF7D0 / #4ADE80)
  // Hingyon - light blue     (#BAE6FD / #38BDF8)
  // Banaue  - dark yellow    (#CA8A04)
  lagawe: {
    badge: "bg-[#800000] text-white", // maroon
    dot: "#800000",
  },
  lamut: {
    badge:
      "bg-[#FEF9C3] text-gray-800 border border-[#FACC15]", // very light yellow
    dot: "#FACC15",
  },
  kiangan: {
    badge:
      "bg-[#BBF7D0] text-gray-800 border border-[#4ADE80]", // light green
    dot: "#4ADE80",
  },
  hingyon: {
    badge:
      "bg-[#BAE6FD] text-gray-800 border border-[#38BDF8]", // light blue
    dot: "#38BDF8",
  },
  banaue: {
    badge: "bg-[#CA8A04] text-black", // dark golden yellow
    dot: "#CA8A04",
  },
};

function getTownKey(town?: string | null) {
  return (town ?? "").toLowerCase().trim();
}

function getTownColorEntry(town?: string | null) {
  const key = getTownKey(town);
  return TOWN_COLORS[key];
}

function getTownBadgeClass(town?: string | null) {
  const entry = getTownColorEntry(town);
  if (!entry) return "bg-gray-200 text-gray-800";
  return entry.badge;
}

function getTownDotColor(town?: string | null) {
  const entry = getTownColorEntry(town);
  if (!entry) return "#9CA3AF"; // gray
  return entry.dot;
}

function formatDriverName(d: ActiveDriver) {
  return d.full_name || d.name || d.callsign || "Unknown driver";
}

function getTownName(d: ActiveDriver): string {
  const town = d.zone_name || d.municipality || "";
  if (!town) return "Unknown town";
  return town;
}

function getStatusLabel(d: ActiveDriver): string {
  const s = (d.status || "").toLowerCase();
  if (!s) return "online";
  if (s === "on_trip" || s === "ontrip") return "On trip";
  if (s === "on_the_way" || s === "on the way") return "On the way";
  return s;
}

// Small trike icon SVG, color-controlled via props
function TrikeIcon({ color }: { color: string }) {
  return (
    <svg
      width={18}
      height={14}
      viewBox="0 0 24 18"
      aria-hidden="true"
      className="shrink-0"
    >
      {/* Body */}
      <rect
        x="4"
        y="6"
        width="9"
        height="5"
        rx="1"
        fill={color}
      />
      {/* Roof */}
      <path
        d="M4 6 L7 2 H13 L12 6 Z"
        fill={color}
      />
      {/* Sidecar */}
      <rect
        x="13"
        y="7"
        width="5"
        height="4"
        rx="0.7"
        fill={color}
      />
      {/* Wheels */}
      <circle cx="7" cy="12.5" r="1.6" fill="#111827" />
      <circle cx="15.5" cy="12.5" r="1.6" fill="#111827" />
      {/* Handlebar */}
      <path
        d="M7 6 L5.5 4.5"
        stroke="#111827"
        strokeWidth="0.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function DriverStatusPanel(props: any) {
  // Defensive prop reading so we don't break existing parent
  const activeDrivers: ActiveDriver[] =
    props?.activeDrivers || props?.drivers || props?.data || [];

  if (!activeDrivers || activeDrivers.length === 0) {
    return (
      <div className="mt-2 text-[11px] text-gray-500">
        No active drivers right now.
      </div>
    );
  }

  return (
    <div className="mt-2">
      {/* Header + legend */}
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-700">
          Drivers (active)
        </h3>
        <div className="flex flex-wrap items-center gap-1 text-[9px] text-gray-400">
          <span className="hidden sm:inline">Town colors:</span>

          <span className="inline-flex items-center gap-1">
            <TrikeIcon color={getTownDotColor("Banaue")} />
            Banaue
          </span>
          <span className="inline-flex items-center gap-1">
            <TrikeIcon color={getTownDotColor("Lagawe")} />
            Lagawe
          </span>
          <span className="inline-flex items-center gap-1">
            <TrikeIcon color={getTownDotColor("Kiangan")} />
            Kiangan
          </span>
          <span className="inline-flex items-center gap-1">
            <TrikeIcon color={getTownDotColor("Hingyon")} />
            Hingyon
          </span>
          <span className="inline-flex items-center gap-1">
            <TrikeIcon color={getTownDotColor("Lamut")} />
            Lamut
          </span>
        </div>
      </div>

      {/* Driver rows */}
      <div className="space-y-1">
        {activeDrivers.map((d, idx) => {
          const town = getTownName(d);
          const badgeClass =
            "inline-flex items-center px-2 py-[2px] rounded-full text-[9px] font-semibold " +
            getTownBadgeClass(town);
          const trikeColor = getTownDotColor(town);

          return (
            <div
              key={d.id ?? idx}
              className="flex items-center justify-between rounded-md border border-gray-100 bg-white px-2 py-1 text-[11px] shadow-sm"
            >
              <div className="flex items-center gap-2">
                <TrikeIcon color={trikeColor} />
                <div className="flex flex-col">
                  <span className="font-semibold text-gray-800">
                    {formatDriverName(d)}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {getStatusLabel(d)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end">
                <span className={badgeClass}>{town}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
