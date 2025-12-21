"use client";

type Trip = {
  status?: string;
};

type LivetripsKpiBannerProps = {
  trips: Trip[];
};

function secondsToMinutesLabel(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "-";
  const m = Math.round(sec / 60);
  return m <= 1 ? "< 1 min" : `${m} min`;
}

function filterStatus(trips: Trip[], statuses: string[]): Trip[] {
  const set = new Set(statuses);
  return trips.filter((t) => t.status && set.has(t.status));
}

function avg(values: (number | null | undefined)[]): number | null {
  const v = values.filter((n): n is number => typeof n === "number" && !isNaN(n));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

type CardProps = {
  label: string;
  value: string | number;
  sub?: string;
};

const Card = ({ label, value, sub }: CardProps) => (
  <div className="flex flex-col rounded-xl border bg-slate-50 px-3 py-2">
    <span className="text-[11px] text-slate-500">{label}</span>
    <span className="text-lg font-semibold text-slate-900">{value}</span>
    {sub && <span className="text-[11px] text-slate-400">{sub}</span>}
  </div>
);

export const LivetripsKpiBanner = ({ trips }: LivetripsKpiBannerProps) => {
  const active = filterStatus(trips, ["assigned", "on_the_way", "on_trip"]).length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
      <Card label="Active Trips" value={active} />
    </div>
  );
};
