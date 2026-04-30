"use client";
import React from "react";
type TripsTownRow = {
  town?: string | null;
  total_trips?: number | null;
  total_revenue?: number | null;
  company_share_total?: number | null;
  toda_share_total?: number | null;
  toda_completed_trips?: number | null;
  toda_breakdown?: Array<{ toda_name?: string | null; trips?: number | null; toda_share_total?: number | null }>;
};
type TripsResponse = {
  ok?: boolean;
  rows?: TripsTownRow[];
  totals?: {
    total_trips?: number | null;
    company_share_total?: number | null;
    toda_share_total?: number | null;
    toda_completed_trips?: number | null;
  };
  error?: string;
};
type DriverRow = {
  driver_id?: string | null;
  driver_name?: string | null;
  municipality?: string | null;
  toda_name?: string | null;
  completed_trips?: number | null;
  toda_completed_trips?: number | null;
  non_toda_completed_trips?: number | null;
  total_toda_share?: number | null;
  total_company_share?: number | null;
  total_platform_revenue?: number | null;
  gross_proposed_fare_earnings?: number | null;
  average_rating?: number | null;
  ratings_count?: number | null;
};
type DriversResponse = {
  ok?: boolean;
  rows?: DriverRow[];
  error?: string;
};
type WatchlistRow = {
  driver_id?: string | null;
  driver_name?: string | null;
  municipality?: string | null;
  completed_trips?: number | null;
  ratings_count?: number | null;
  average_rating?: number | null;
  low_ratings_count?: number | null;
  latest_feedback?: string | null;
  latest_rating_at?: string | null;
};
type WatchlistResponse = {
  ok?: boolean;
  rows?: WatchlistRow[];
  error?: string;
};
type FailureRow = {
  id?: string | null;
  created_at?: string | null;
  passenger_id?: string | null;
  passenger_name?: string | null;
  town?: string | null;
  from_label?: string | null;
  to_label?: string | null;
  requested_vehicle_type?: string | null;
  alternate_vehicle_type?: string | null;
  code?: string | null;
  message?: string | null;
  local_requested_count?: number | null;
  local_alternate_count?: number | null;
  emergency_requested_count?: number | null;
  emergency_alternate_count?: number | null;
};
type FailuresResponse = {
  ok?: boolean;
  rows?: FailureRow[];
  totals?: { total_failures?: number | null; by_town?: Record<string, number> };
  error?: string;
};
type PresenceRow = {
  passenger_id?: string | null;
  passenger_name?: string | null;
  town?: string | null;
  app_state?: string | null;
  screen_name?: string | null;
  last_seen_at?: string | null;
  last_booking_code?: string | null;
  platform?: string | null;
  is_active_now?: boolean | null;
};
type PresenceTownRow = {
  town?: string | null;
  active_now?: number | null;
};
type PresenceResponse = {
  ok?: boolean;
  freshness_seconds?: number | null;
  counts?: {
    active_now?: number | null;
    foreground_now?: number | null;
    background_now?: number | null;
    offline_marked_now?: number | null;
    with_booking_now?: number | null;
    searching_now?: number | null;
  };
  towns?: PresenceTownRow[];
  rows?: PresenceRow[];
  error?: string;
};
type DriverWorkforceRow = {
  driver_id?: string | null;
  driver_name?: string | null;
  town?: string | null;
  municipality?: string | null;
  today_online_minutes?: number | null;
  week_online_minutes?: number | null;
  month_online_minutes?: number | null;
  today_login_count?: number | null;
  week_qualified_days?: number | null;
  month_qualified_days?: number | null;
  accepted_bookings?: number | null;
  assigned_bookings?: number | null;
  completed_trips?: number | null;
  last_seen_at?: string | null;
  current_status?: string | null;
  is_online_now?: boolean | null;
};
type DriverCoverageGapRow = {
  town?: string | null;
  date?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  minutes?: number | null;
  label?: string | null;
};
type DriverWorkforceResponse = {
  ok?: boolean;
  rows?: DriverWorkforceRow[];
  gaps?: DriverCoverageGapRow[];
  source?: {
    mode?: string | null;
    roster_source?: string | null;
    profile_usage?: string | null;
    note?: string | null;
  };
  summary?: {
    active_drivers_now?: number | null;
    drivers_logged_in_today?: number | null;
    total_online_minutes_today?: number | null;
    avg_online_minutes_today?: number | null;
    qualified_today?: number | null;
    qualified_this_week?: number | null;
    no_driver_minutes_today?: number | null;
    worst_gap_start_at?: string | null;
    worst_gap_end_at?: string | null;
    worst_gap_minutes?: number | null;
  };
  error?: string;
};
type ScopeOption = "all" | "Lagawe" | "Hingyon" | "Banaue" | "Lamut" | "Kiangan" | "Unknown";
const CURRENCY = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});
const NUMBER = new Intl.NumberFormat("en-PH");
function formatPeso(v: number) {
  return CURRENCY.format(Number.isFinite(v) ? v : 0);
}
function formatCount(v: number) {
  return NUMBER.format(Number.isFinite(v) ? v : 0);
}
function formatPHDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}
function formatSecondsLabel(value?: number | null) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n < 60) return `${n} sec`;
  const minutes = Math.floor(n / 60);
  const seconds = n % 60;
  return seconds ? `${minutes} min ${seconds} sec` : `${minutes} min`;
}
function formatMinutesLabel(value?: number | null) {
  const n = Math.max(0, Math.round(Number(value || 0)));
  if (!Number.isFinite(n) || n <= 0) return "0m";
  const hours = Math.floor(n / 60);
  const minutes = n % 60;
  if (hours <= 0) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}
function formatAcceptanceRate(accepted?: number | null, assigned?: number | null) {
  const a = Number(accepted || 0);
  const b = Number(assigned || 0);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return "-";
  return `${Math.round((a / b) * 100)}%`;
}
function gapLabel(startAt?: string | null, endAt?: string | null, minutes?: number | null) {
  const length = formatMinutesLabel(minutes);
  if (!startAt || !endAt) return length === "0m" ? "-" : length;
  return `${formatPHDateTime(startAt)} to ${formatPHDateTime(endAt)} (${length})`;
}
function formatPHNow() {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}
function toCsvCell(v: unknown) {
  const s = String(v ?? "").replace(/"/g, '""');
  return `"${s}"`;
}
function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>) {
  const csv = [headers.map(toCsvCell).join(","), ...rows.map((r) => r.map(toCsvCell).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function townMatch(scope: ScopeOption, town?: string | null) {
  if (scope === "all") return true;
  return String(town || "Unknown") === scope;
}
function Card({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</div>
      <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</div>
      {sub ? <div className="mt-2 text-sm text-slate-500">{sub}</div> : null}
    </div>
  );
}
export default function AdminAnalyticsPage() {
  const [scope, setScope] = React.useState<ScopeOption>("all");
  const [lastRefresh, setLastRefresh] = React.useState<string>(formatPHNow());
  const [loading, setLoading] = React.useState<boolean>(true);
  const [msg, setMsg] = React.useState<string>("");
  const [tripRows, setTripRows] = React.useState<TripsTownRow[]>([]);
  const [driverRows, setDriverRows] = React.useState<DriverRow[]>([]);
  const [watchRows, setWatchRows] = React.useState<WatchlistRow[]>([]);
  const [failureRows, setFailureRows] = React.useState<FailureRow[]>([]);
  const [presenceRows, setPresenceRows] = React.useState<PresenceRow[]>([]);
  const [presenceTowns, setPresenceTowns] = React.useState<PresenceTownRow[]>([]);
  const [presenceFreshnessSeconds, setPresenceFreshnessSeconds] = React.useState<number>(90);
  const [presenceCounts, setPresenceCounts] = React.useState<NonNullable<PresenceResponse["counts"]>>({
    active_now: 0,
    foreground_now: 0,
    background_now: 0,
    offline_marked_now: 0,
    with_booking_now: 0,
    searching_now: 0,
  });
  const [driverWorkforceRows, setDriverWorkforceRows] = React.useState<DriverWorkforceRow[]>([]);
  const [driverCoverageGaps, setDriverCoverageGaps] = React.useState<DriverCoverageGapRow[]>([]);
  const [driverWorkforceSummary, setDriverWorkforceSummary] = React.useState<NonNullable<DriverWorkforceResponse["summary"]>>({
    active_drivers_now: 0,
    drivers_logged_in_today: 0,
    total_online_minutes_today: 0,
    avg_online_minutes_today: 0,
    qualified_today: 0,
    qualified_this_week: 0,
    no_driver_minutes_today: 0,
    worst_gap_minutes: 0,
  });
  const [driverWorkforceStatus, setDriverWorkforceStatus] = React.useState<string>("Not loaded yet.");
  const load = React.useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const [tripRes, driverRes, watchRes, failRes, presenceRes] = await Promise.all([
        fetch("/api/admin/analytics/trips", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/analytics/drivers?limit=20", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/analytics/driver-watchlist?limit=8", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/analytics/no-driver-searches?limit=100", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/analytics/passenger-presence?freshness_seconds=90", { cache: "no-store", credentials: "same-origin" }),
      ]);
      const tripsJson = (await tripRes.json().catch(() => ({}))) as TripsResponse;
      const driversJson = (await driverRes.json().catch(() => ({}))) as DriversResponse;
      const watchJson = (await watchRes.json().catch(() => ({}))) as WatchlistResponse;
      const failJson = (await failRes.json().catch(() => ({}))) as FailuresResponse;
      const presenceJson = (await presenceRes.json().catch(() => ({}))) as PresenceResponse;
      if (!tripRes.ok) throw new Error(tripsJson.error || "Failed to load trips analytics.");
      if (!driverRes.ok) throw new Error(driversJson.error || "Failed to load driver analytics.");
      if (!watchRes.ok) throw new Error(watchJson.error || "Failed to load driver watchlist.");
      if (!failRes.ok) throw new Error(failJson.error || "Failed to load no-driver analytics.");
      if (!presenceRes.ok) throw new Error(presenceJson.error || "Failed to load passenger presence analytics.");
      setTripRows(Array.isArray(tripsJson.rows) ? tripsJson.rows : []);
      setDriverRows(Array.isArray(driversJson.rows) ? driversJson.rows : []);
      setWatchRows(Array.isArray(watchJson.rows) ? watchJson.rows : []);
      setFailureRows(Array.isArray(failJson.rows) ? failJson.rows : []);
      setPresenceRows(Array.isArray(presenceJson.rows) ? presenceJson.rows : []);
      setPresenceTowns(Array.isArray(presenceJson.towns) ? presenceJson.towns : []);
      setPresenceFreshnessSeconds(Number(presenceJson.freshness_seconds || 90));
      setPresenceCounts({
        active_now: Number(presenceJson.counts?.active_now || 0),
        foreground_now: Number(presenceJson.counts?.foreground_now || 0),
        background_now: Number(presenceJson.counts?.background_now || 0),
        offline_marked_now: Number(presenceJson.counts?.offline_marked_now || 0),
        with_booking_now: Number(presenceJson.counts?.with_booking_now || 0),
        searching_now: Number(presenceJson.counts?.searching_now || 0),
      });
      try {
        const workforceRes = await fetch("/api/admin/analytics/driver-workforce?freshness_seconds=180", { cache: "no-store", credentials: "same-origin" });
        if (workforceRes.ok) {
          const workforceJson = (await workforceRes.json().catch(() => ({}))) as DriverWorkforceResponse;
          setDriverWorkforceRows(Array.isArray(workforceJson.rows) ? workforceJson.rows : []);
          setDriverCoverageGaps(Array.isArray(workforceJson.gaps) ? workforceJson.gaps : []);
          setDriverWorkforceSummary({
            active_drivers_now: Number(workforceJson.summary?.active_drivers_now || 0),
            drivers_logged_in_today: Number(workforceJson.summary?.drivers_logged_in_today || 0),
            total_online_minutes_today: Number(workforceJson.summary?.total_online_minutes_today || 0),
            avg_online_minutes_today: Number(workforceJson.summary?.avg_online_minutes_today || 0),
            qualified_today: Number(workforceJson.summary?.qualified_today || 0),
            qualified_this_week: Number(workforceJson.summary?.qualified_this_week || 0),
            no_driver_minutes_today: Number(workforceJson.summary?.no_driver_minutes_today || 0),
            worst_gap_start_at: workforceJson.summary?.worst_gap_start_at || null,
            worst_gap_end_at: workforceJson.summary?.worst_gap_end_at || null,
            worst_gap_minutes: Number(workforceJson.summary?.worst_gap_minutes || 0),
          });
          const mode = String(workforceJson.source?.mode || "snapshot_only");
          setDriverWorkforceStatus(mode === "snapshot_only" ? "Live snapshot mode: driver_locations plus bookings. No driver session history table exists yet." : "Loaded from /api/admin/analytics/driver-workforce.");
        } else {
          setDriverWorkforceRows([]);
          setDriverCoverageGaps([]);
          setDriverWorkforceStatus("Driver workforce endpoint is not available yet. Existing analytics remain unchanged.");
        }
      } catch {
        setDriverWorkforceRows([]);
        setDriverCoverageGaps([]);
        setDriverWorkforceStatus("Driver workforce endpoint is not available yet. Existing analytics remain unchanged.");
      }
      setLastRefresh(formatPHNow());
    } catch (e: any) {
      setMsg(e?.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    let alive = true;
    const run = async () => {
      if (alive) await load();
    };
    void run();
    return () => {
      alive = false;
    };
  }, [load]);
  const scopedTrips = React.useMemo(() => tripRows.filter((r) => townMatch(scope, r.town)), [tripRows, scope]);
  const scopedDrivers = React.useMemo(() => driverRows.filter((r) => townMatch(scope, r.municipality)), [driverRows, scope]);
  const scopedWatch = React.useMemo(() => watchRows.filter((r) => townMatch(scope, r.municipality)), [watchRows, scope]);
  const scopedFailures = React.useMemo(() => failureRows.filter((r) => townMatch(scope, r.town)), [failureRows, scope]);
  const scopedPresenceRows = React.useMemo(() => presenceRows.filter((r) => townMatch(scope, r.town)), [presenceRows, scope]);
  const scopedPresenceTowns = React.useMemo(() => {
    if (scope === "all") return presenceTowns;
    return presenceTowns.filter((r) => townMatch(scope, r.town));
  }, [presenceTowns, scope]);
  const scopedDriverWorkforceRows = React.useMemo(() => driverWorkforceRows.filter((r) => townMatch(scope, r.town ?? r.municipality)), [driverWorkforceRows, scope]);
  const scopedDriverCoverageGaps = React.useMemo(() => driverCoverageGaps.filter((r) => townMatch(scope, r.town)), [driverCoverageGaps, scope]);
  const driverWorkforceTotals = React.useMemo(() => {
    const rows = scopedDriverWorkforceRows;
    const activeNow = rows.filter((r) => !!r.is_online_now || String(r.current_status || "").toLowerCase() === "online").length;
    const loggedInToday = rows.filter((r) => Number(r.today_online_minutes || 0) > 0 || Number(r.today_login_count || 0) > 0).length;
    const totalToday = rows.reduce((sum, r) => sum + Number(r.today_online_minutes || 0), 0);
    const avgToday = loggedInToday > 0 ? Math.round(totalToday / loggedInToday) : 0;
    const qualifiedToday = rows.filter((r) => Number(r.today_online_minutes || 0) >= 480).length;
    const qualifiedWeek = rows.filter((r) => Number(r.week_qualified_days || 0) >= 5).length;
    const noDriverMinutes = scope === "all"
      ? Number(driverWorkforceSummary.no_driver_minutes_today || 0)
      : scopedDriverCoverageGaps.reduce((sum, r) => sum + Number(r.minutes || 0), 0);
    const worstGap = scopedDriverCoverageGaps.slice().sort((a, b) => Number(b.minutes || 0) - Number(a.minutes || 0))[0] || null;
    return { activeNow, loggedInToday, totalToday, avgToday, qualifiedToday, qualifiedWeek, noDriverMinutes, worstGap };
  }, [scopedDriverWorkforceRows, scopedDriverCoverageGaps, driverWorkforceSummary, scope]);
  const driverLiveCoverageRows = React.useMemo(() => {
    const map = new Map<string, { town: string; roster: number; online: number; fresh: number; lastSeen: string | null }>();
    for (const row of scopedDriverWorkforceRows) {
      const town = String(row.town ?? row.municipality ?? "Unknown");
      const current = map.get(town) || { town, roster: 0, online: 0, fresh: 0, lastSeen: null };
      current.roster += 1;
      if (!!row.is_online_now || String(row.current_status || "").toLowerCase() === "online") {
        current.online += 1;
        current.fresh += 1;
      }
      const last = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
      const prev = current.lastSeen ? new Date(current.lastSeen).getTime() : 0;
      if (last && (!prev || last > prev)) current.lastSeen = row.last_seen_at || null;
      map.set(town, current);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.online !== a.online) return b.online - a.online;
      if (b.roster !== a.roster) return b.roster - a.roster;
      return a.town.localeCompare(b.town);
    });
  }, [scopedDriverWorkforceRows]);
  const driverActivationRows = React.useMemo(() => {
    const nowMs = Date.now();
    return scopedDriverWorkforceRows
      .map((row) => {
        const lastSeenMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
        const daysInactive = lastSeenMs > 0 ? Math.floor((nowMs - lastSeenMs) / 86400000) : 999;
        const assigned = Number(row.assigned_bookings || 0);
        const accepted = Number(row.accepted_bookings || 0);
        const completed = Number(row.completed_trips || 0);
        const acceptanceRate = assigned > 0 ? Math.round((accepted / assigned) * 100) : null;
        const isOnline = !!row.is_online_now || String(row.current_status || "").toLowerCase() === "online";
        const flags: string[] = [];

        if (!isOnline && daysInactive >= 7) flags.push("Offline 7d+");
        if (!isOnline && daysInactive >= 14) flags.push("Offline 14d+");
        if (assigned > 0 && accepted === 0) flags.push("No accepts");
        if (acceptanceRate !== null && acceptanceRate < 50) flags.push("Low accept");
        if (completed === 0 && assigned > 0) flags.push("No completed trips");

        let priority = 0;
        if (daysInactive >= 14) priority += 40;
        else if (daysInactive >= 7) priority += 25;
        if (assigned > 0 && accepted === 0) priority += 25;
        if (acceptanceRate !== null && acceptanceRate < 50) priority += 15;
        if (completed === 0 && assigned > 0) priority += 10;

        return {
          driver_id: row.driver_id,
          driver_name: row.driver_name || "Unknown Driver",
          town: row.town ?? row.municipality ?? "Unknown",
          isOnline,
          daysInactive,
          lastSeen: row.last_seen_at || null,
          assigned,
          accepted,
          completed,
          acceptanceRate,
          flags,
          priority,
        };
      })
      .filter((row) => row.flags.length > 0)
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if (b.daysInactive !== a.daysInactive) return b.daysInactive - a.daysInactive;
        return a.driver_name.localeCompare(b.driver_name);
      })
      .slice(0, 12);
  }, [scopedDriverWorkforceRows]);
  const driverActivationSummary = React.useMemo(() => {
    const offline7 = driverActivationRows.filter((row) => row.daysInactive >= 7).length;
    const offline14 = driverActivationRows.filter((row) => row.daysInactive >= 14).length;
    const lowAccept = driverActivationRows.filter((row) => row.flags.includes("Low accept") || row.flags.includes("No accepts")).length;
    return { offline7, offline14, lowAccept, total: driverActivationRows.length };
  }, [driverActivationRows]);
  const presenceTotals = React.useMemo(() => {
    const activeNow = scopedPresenceRows.length;
    const foregroundNow = scopedPresenceRows.filter((r) => String(r.app_state || "foreground") === "foreground").length;
    const backgroundNow = scopedPresenceRows.filter((r) => String(r.app_state || "") === "background").length;
    const offlineMarkedNow = scopedPresenceRows.filter((r) => String(r.app_state || "") === "offline").length;
    const withBookingNow = scopedPresenceRows.filter((r) => !!r.last_booking_code).length;
    const searchingNow = scopedPresenceRows.filter((r) => {
      const screen = String(r.screen_name || "").toLowerCase();
      return !r.last_booking_code && ["passengerbookrideactivity", "passengersearchingactivity", "search", "booking", "home"].includes(screen);
    }).length;
    return { activeNow, foregroundNow, backgroundNow, offlineMarkedNow, withBookingNow, searchingNow };
  }, [scopedPresenceRows]);
  const totals = React.useMemo(() => {
    const totalTrips = scopedTrips.reduce((sum, row) => sum + Number(row.total_trips || 0), 0);
    const companyShareTotal = scopedTrips.reduce((sum, row) => sum + Number((row.company_share_total ?? row.total_revenue) || 0), 0);
    const todaShareTotal = scopedTrips.reduce((sum, row) => sum + Number(row.toda_share_total || 0), 0);
    const todaTrips = scopedTrips.reduce((sum, row) => sum + Number(row.toda_completed_trips || 0), 0);
    const grossProposedFareEarnings = scopedDrivers.reduce((sum, row) => sum + Number(row.gross_proposed_fare_earnings || 0), 0);
    const towns = new Set(scopedTrips.map((r) => String(r.town || "Unknown (legacy data)")));
    return {
      totalTrips,
      companyShareTotal,
      todaShareTotal,
      todaTrips,
      grossProposedFareEarnings,
      towns: towns.size,
      watchCount: scopedWatch.length,
      noDriverCount: scopedFailures.length,
    };
  }, [scopedTrips, scopedDrivers, scopedWatch, scopedFailures]);
  const exportTrips = React.useCallback(() => {
    downloadCsv(
      `jride-analytics-trips-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Town", "Completed Trips", "Company Share", "TODA Share", "TODA Trips"],
      scopedTrips.map((r) => [
        r.town || "Unknown (legacy data)",
        Number(r.total_trips || 0),
        Number((r.company_share_total ?? r.total_revenue) || 0),
        Number(r.toda_share_total || 0),
        Number(r.toda_completed_trips || 0),
      ])
    );
  }, [scopedTrips, scope]);
  const exportDrivers = React.useCallback(() => {
    downloadCsv(
      `jride-analytics-drivers-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Driver", "Town", "TODA", "Completed Trips", "Gross Proposed Fare", "Company Share", "TODA Share", "Average Rating", "Ratings Count"],
      scopedDrivers.map((r) => [
        r.driver_name || "Unknown Driver",
        r.municipality || "Unknown (legacy data)",
        r.toda_name || "-",
        Number(r.completed_trips || 0),
        Number(r.gross_proposed_fare_earnings || 0),
        Number((r.total_company_share ?? r.total_platform_revenue) || 0),
        Number(r.total_toda_share || 0),
        Number(r.average_rating || 0).toFixed(2),
        Number(r.ratings_count || 0),
      ])
    );
  }, [scopedDrivers, scope]);
  const exportFailures = React.useCallback(() => {
    downloadCsv(
      `jride-no-driver-searches-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Passenger", "Town", "Time (PHT)", "Pickup", "Dropoff", "Requested Vehicle", "Alternate Vehicle", "Code", "Message"],
      scopedFailures.map((r) => [
        r.passenger_name || "Unknown Passenger",
        r.town || "Unknown (legacy data)",
        formatPHDateTime(r.created_at),
        r.from_label || "-",
        r.to_label || "-",
        r.requested_vehicle_type || "-",
        r.alternate_vehicle_type || "-",
        r.code || "-",
        r.message || "-",
      ])
    );
  }, [scopedFailures, scope]);
  const exportPresence = React.useCallback(() => {
    downloadCsv(
      `jride-passenger-presence-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Passenger", "Town", "App State", "Screen", "Last Seen (PHT)", "Booking Code", "Platform"],
      scopedPresenceRows.map((r) => [
        r.passenger_name || "Unknown Passenger",
        r.town || "Unknown",
        r.app_state || "foreground",
        r.screen_name || "-",
        formatPHDateTime(r.last_seen_at),
        r.last_booking_code || "-",
        r.platform || "-",
      ])
    );
  }, [scopedPresenceRows, scope]);
  const exportDriverWorkforce = React.useCallback(() => {
    downloadCsv(
      `jride-driver-workforce-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Driver", "Town", "Status", "Online Now", "Today Hours", "Week Hours", "Month Hours", "Login Count Today", "Week Qualified Days", "Acceptance Rate", "Completed Trips", "Last Seen (PHT)"],
      scopedDriverWorkforceRows.map((r) => [
        r.driver_name || "Unknown Driver",
        r.town ?? r.municipality ?? "Unknown",
        r.current_status || "-",
        r.is_online_now ? "Yes" : "No",
        formatMinutesLabel(r.today_online_minutes),
        formatMinutesLabel(r.week_online_minutes),
        formatMinutesLabel(r.month_online_minutes),
        Number(r.today_login_count || 0),
        Number(r.week_qualified_days || 0),
        formatAcceptanceRate(r.accepted_bookings, r.assigned_bookings),
        Number(r.completed_trips || 0),
        formatPHDateTime(r.last_seen_at),
      ])
    );
  }, [scopedDriverWorkforceRows, scope]);
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-xl">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">JRide Analytics Center</div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Operations analytics, company share, TODA share, passenger presence, driver workforce, and no-driver demand</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">Built for expansion. View town-filtered results, export CSV reports, and monitor partner-safe metrics using Philippine date and time.</p>
            </div>
            <div className="grid w-full grid-cols-1 gap-3 text-sm text-slate-300 sm:w-auto sm:min-w-[280px] sm:grid-cols-1 xl:grid-cols-2">
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-400">Timezone</div><div className="mt-1 break-words font-semibold leading-snug text-white">Asia/Manila (PHT)</div></div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><div className="text-xs uppercase tracking-[0.14em] text-slate-400">Last refresh</div><div className="mt-1 break-words font-semibold leading-snug text-white">{lastRefresh}</div></div>
            </div>
          </div>
        </section>
        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Scope and exports</div>
              <p className="mt-1 text-sm text-slate-500">Use town filtering now so future partner access can stay town-scoped.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700" value={scope} onChange={(e) => setScope(e.target.value as ScopeOption)}>
                <option value="all">All towns</option>
                <option value="Lagawe">Lagawe</option>
                <option value="Hingyon">Hingyon</option>
                <option value="Banaue">Banaue</option>
                <option value="Lamut">Lamut</option>
                <option value="Kiangan">Kiangan</option>
                <option value="Unknown">Unknown</option>
              </select>
              <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800" onClick={() => void load()} disabled={loading}>Refresh</button>
              <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={exportTrips}>Export trips CSV</button>
              <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={exportDrivers}>Export drivers CSV</button>
              <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={exportFailures}>Export no-driver CSV</button>
              <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={exportPresence}>Export presence CSV</button>
              <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={exportDriverWorkforce}>Export driver workforce CSV</button>
            </div>
          </div>
          {msg ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{msg}</div> : null}
        </section>
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <Card title="Completed trips" value={formatCount(totals.totalTrips)} sub="All filtered towns" />
          <Card title="Company share" value={formatPeso(totals.companyShareTotal)} sub="PHP 14 when TODA ride, PHP 15 otherwise" />
          <Card title="TODA share" value={formatPeso(totals.todaShareTotal)} sub="PHP 1 per TODA member ride" />
          <Card title="TODA rides" value={formatCount(totals.todaTrips)} sub="Completed trips with a TODA member driver" />
          <Card title="Driver gross fares" value={formatPeso(totals.grossProposedFareEarnings)} sub="Sum of completed-trip proposed fares" />
          <Card title="No-driver searches" value={formatCount(totals.noDriverCount)} sub="Passengers who searched but got no driver" />
        </section>
        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-900">Driver workforce intelligence</h2>
              <p className="mt-1 text-sm text-slate-500">Read-only driver workforce snapshot. Current production DB has driver_locations and bookings, but no driver session history table yet, so attendance-hour and coverage-gap metrics stay disabled instead of being faked.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Data source</div>
              <div className="mt-1 font-semibold">{driverWorkforceStatus}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <Card title="Drivers online now" value={formatCount(driverWorkforceTotals.activeNow || Number(driverWorkforceSummary.active_drivers_now || 0))} sub="Fresh online drivers in scope" />
            <Card title="Logged in today" value={formatCount(driverWorkforceTotals.loggedInToday || Number(driverWorkforceSummary.drivers_logged_in_today || 0))} sub="Disabled until driver session logs exist" />
            <Card title="Online hours today" value={formatMinutesLabel(driverWorkforceTotals.totalToday || Number(driverWorkforceSummary.total_online_minutes_today || 0))} sub="Disabled until driver session logs exist" />
            <Card title="Qualified today" value={formatCount(driverWorkforceTotals.qualifiedToday || Number(driverWorkforceSummary.qualified_today || 0))} sub="Needs session history" />
            <Card title="Qualified this week" value={formatCount(driverWorkforceTotals.qualifiedWeek || Number(driverWorkforceSummary.qualified_this_week || 0))} sub="Needs session history" />
            <Card title="No-driver time today" value={formatMinutesLabel(driverWorkforceTotals.noDriverMinutes)} sub="Needs session history" />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Driver recent activity ranking</h3>
              <p className="mt-1 text-xs text-slate-500">Uses driver_locations recent activity plus booking acceptance data. This panel is display-only and does not change dispatch, wallets, or lifecycle.</p>
              <div className="mt-3 max-h-[390px] overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-2 pl-3 pr-4 font-semibold">Driver</th><th className="py-2 pr-4 font-semibold">Town</th><th className="py-2 pr-4 font-semibold">Today</th><th className="py-2 pr-4 font-semibold">Logins</th><th className="py-2 pr-4 font-semibold">Week days</th><th className="py-2 pr-4 font-semibold">Accept</th><th className="py-2 font-semibold">Last seen</th></tr></thead>
                  <tbody>
                    {scopedDriverWorkforceRows.length === 0 ? <tr><td colSpan={7} className="py-4 text-slate-400">No driver workforce rows yet for this scope. Add /api/admin/analytics/driver-workforce when backend attendance data is ready.</td></tr> : scopedDriverWorkforceRows.slice(0, 25).map((row, idx) => (
                      <tr key={String(row.driver_id || `${row.driver_name || "driver"}-${idx}`)} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pl-3 pr-4 font-medium text-slate-900">{row.driver_name || "Unknown Driver"}</td>
                        <td className="py-2 pr-4 text-slate-700">{row.town ?? row.municipality ?? "Unknown"}</td>
                        <td className="py-2 pr-4 text-slate-700">{formatMinutesLabel(row.today_online_minutes)}</td>
                        <td className="py-2 pr-4 text-slate-700">{formatCount(Number(row.today_login_count || 0))}</td>
                        <td className="py-2 pr-4 text-slate-700">{formatCount(Number(row.week_qualified_days || 0))} / 5</td>
                        <td className="py-2 pr-4 text-slate-700">{formatAcceptanceRate(row.accepted_bookings, row.assigned_bookings)}</td>
                        <td className="py-2 text-slate-700">{formatPHDateTime(row.last_seen_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Live coverage by town</h3>
              <p className="mt-1 text-xs text-slate-500">Uses real driver_locations snapshot data only. This replaces the empty coverage-gap space until a real driver session history table exists.</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Online</div>
                  <div className="mt-1 text-2xl font-bold text-slate-950">{formatCount(driverWorkforceTotals.activeNow || Number(driverWorkforceSummary.active_drivers_now || 0))}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Roster</div>
                  <div className="mt-1 text-2xl font-bold text-slate-950">{formatCount(scopedDriverWorkforceRows.length)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Mode</div>
                  <div className="mt-1 text-sm font-bold text-slate-950">Snapshot</div>
                </div>
              </div>
              <div className="mt-3 max-h-[390px] overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-2 pl-3 pr-4 font-semibold">Town</th><th className="py-2 pr-4 font-semibold">Online</th><th className="py-2 pr-4 font-semibold">Roster</th><th className="py-2 pr-3 font-semibold">Latest seen</th></tr></thead>
                  <tbody>
                    {driverLiveCoverageRows.length === 0 ? <tr><td colSpan={4} className="px-3 py-4 text-slate-400">No live driver coverage rows for this scope.</td></tr> : driverLiveCoverageRows.map((row) => (
                      <tr key={row.town} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pl-3 pr-4 font-medium text-slate-900">{row.town}</td>
                        <td className="py-2 pr-4 text-slate-700">{formatCount(row.online)}</td>
                        <td className="py-2 pr-4 text-slate-700">{formatCount(row.roster)}</td>
                        <td className="py-2 pr-3 text-slate-700">{formatPHDateTime(row.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                No-driver gap history remains disabled because no driver session history table exists in production. This panel uses only truthful live snapshot data.
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-900">Driver activation center</h2>
              <p className="mt-1 text-sm text-slate-500">Read-only activation risk view using the same driver_locations and bookings snapshot. This does not change dispatch, wallets, lifecycle, or driver status.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Action queue</div>
              <div className="mt-1 font-semibold text-slate-950">{formatCount(driverActivationSummary.total)} drivers</div>
              <div className="mt-1 text-xs text-slate-500">Snapshot only. No automated changes.</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card title="Offline 7d+" value={formatCount(driverActivationSummary.offline7)} sub="Needs coordinator follow-up" />
            <Card title="Offline 14d+" value={formatCount(driverActivationSummary.offline14)} sub="High reactivation risk" />
            <Card title="Low accept risk" value={formatCount(driverActivationSummary.lowAccept)} sub="Accepted less than 50% or none" />
            <Card title="Mode" value="Read-only" sub="No dispatch or wallet writes" />
          </div>
          <div className="mt-5 overflow-auto rounded-2xl border border-slate-200 bg-slate-50">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pl-3 pr-4 font-semibold">Driver</th>
                  <th className="py-2 pr-4 font-semibold">Town</th>
                  <th className="py-2 pr-4 font-semibold">Risk flags</th>
                  <th className="py-2 pr-4 font-semibold">Accept</th>
                  <th className="py-2 pr-4 font-semibold">Trips</th>
                  <th className="py-2 pr-3 font-semibold">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {driverActivationRows.length === 0 ? <tr><td colSpan={6} className="px-3 py-4 text-slate-400">No driver activation risks found for this scope.</td></tr> : driverActivationRows.map((row) => (
                  <tr key={String(row.driver_id || row.driver_name)} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pl-3 pr-4 font-medium text-slate-900">{row.driver_name}</td>
                    <td className="py-2 pr-4 text-slate-700">{row.town}</td>
                    <td className="py-2 pr-4 text-slate-700">
                      <div className="flex flex-wrap gap-1">
                        {row.flags.map((flag) => (
                          <span key={flag} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{flag}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-slate-700">{row.acceptanceRate === null ? "-" : `${row.acceptanceRate}%`}</td>
                    <td className="py-2 pr-4 text-slate-700">{formatCount(row.completed)}</td>
                    <td className="py-2 pr-3 text-slate-700">{formatPHDateTime(row.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            Suggested use: call or message these drivers, check wallet readiness manually, and coordinate with TODA leads. This panel is display-only.
          </div>
        </section>
        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-900">Passenger presence live panel</h2>
              <p className="mt-1 text-sm text-slate-500">Read-only live demand view from passenger_app_presence. Fresh rows only. Current freshness window: {formatSecondsLabel(presenceFreshnessSeconds)}.</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Scope summary</div>
              <div className="mt-1 font-semibold">{scope === "all" ? "All towns" : scope}</div>
              <div className="mt-1 text-xs text-emerald-700">API total active now: {formatCount(Number(presenceCounts.active_now || 0))}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Card title="Active passengers now" value={formatCount(presenceTotals.activeNow)} sub="Fresh presence rows in scope" />
            <Card title="Foreground now" value={formatCount(presenceTotals.foregroundNow)} sub="App_state = foreground" />
            <Card title="Searching now" value={formatCount(presenceTotals.searchingNow)} sub="No booking code on booking/search/home screens" />
            <Card title="Background now" value={formatCount(presenceTotals.backgroundNow)} sub="App_state = background" />
            <Card title="With booking now" value={formatCount(presenceTotals.withBookingNow)} sub="Presence rows carrying a booking code" />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Active by town</h3>
              <p className="mt-1 text-xs text-slate-500">Counts are filtered by the selected town scope.</p>
              <div className="mt-3 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-2 pr-4 font-semibold">Town</th><th className="py-2 font-semibold">Active now</th></tr></thead>
                  <tbody>
                    {scopedPresenceTowns.length === 0 ? <tr><td colSpan={2} className="py-4 text-slate-400">No active passenger presence rows for this scope.</td></tr> : scopedPresenceTowns.map((row) => (
                      <tr key={String(row.town || "Unknown")} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 font-medium text-slate-900">{row.town || "Unknown"}</td>
                        <td className="py-2 text-slate-700">{formatCount(Number(row.active_now || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Current booking screen users</h3>
              <p className="mt-1 text-xs text-slate-500">Passengers on booking and searching surfaces without an active booking code.</p>
              <div className="mt-3 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-2 pr-4 font-semibold">Passenger</th><th className="py-2 pr-4 font-semibold">Town</th><th className="py-2 pr-4 font-semibold">Screen</th><th className="py-2 font-semibold">Last seen</th></tr></thead>
                  <tbody>
                    {scopedPresenceRows.filter((row) => !row.last_booking_code).filter((row) => {
                      const screen = String(row.screen_name || "").toLowerCase();
                      return ["passengerbookrideactivity", "passengersearchingactivity", "search", "booking", "home"].includes(screen);
                    }).length === 0 ? <tr><td colSpan={4} className="py-4 text-slate-400">No current booking-screen users in this scope.</td></tr> : scopedPresenceRows.filter((row) => !row.last_booking_code).filter((row) => {
                      const screen = String(row.screen_name || "").toLowerCase();
                      return ["passengerbookrideactivity", "passengersearchingactivity", "search", "booking", "home"].includes(screen);
                    }).map((row) => (
                      <tr key={String(row.passenger_id || row.last_seen_at || Math.random())} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 font-medium text-slate-900">{row.passenger_name || "Unknown Passenger"}</td>
                        <td className="py-2 pr-4 text-slate-700">{row.town || "Unknown"}</td>
                        <td className="py-2 pr-4 text-slate-700">{row.screen_name || "-"}</td>
                        <td className="py-2 text-slate-700">{formatPHDateTime(row.last_seen_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Recent active passengers</h3>
            <p className="mt-1 text-xs text-slate-500">Most recent fresh presence rows in the selected town scope.</p>
            <div className="mt-3 overflow-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-2 pr-4 font-semibold">Passenger</th><th className="py-2 pr-4 font-semibold">Town</th><th className="py-2 pr-4 font-semibold">App state</th><th className="py-2 pr-4 font-semibold">Screen</th><th className="py-2 pr-4 font-semibold">Booking code</th><th className="py-2 pr-4 font-semibold">Platform</th><th className="py-2 font-semibold">Last seen</th></tr></thead>
                <tbody>
                  {scopedPresenceRows.length === 0 ? <tr><td colSpan={7} className="py-4 text-slate-400">No active passenger presence rows for this scope.</td></tr> : scopedPresenceRows.slice(0, 25).map((row, idx) => (
                    <tr key={String(row.passenger_id || `${row.last_seen_at || "row"}-${idx}`)} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 font-medium text-slate-900">{row.passenger_name || "Unknown Passenger"}</td>
                      <td className="py-2 pr-4 text-slate-700">{row.town || "Unknown"}</td>
                      <td className="py-2 pr-4 text-slate-700">{row.app_state || "foreground"}</td>
                      <td className="py-2 pr-4 text-slate-700">{row.screen_name || "-"}</td>
                      <td className="py-2 pr-4 text-slate-700">{row.last_booking_code || "-"}</td>
                      <td className="py-2 pr-4 text-slate-700">{row.platform || "-"}</td>
                      <td className="py-2 text-slate-700">{formatPHDateTime(row.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">Trips, company share, and TODA share by town</h2>
            <p className="mt-1 text-sm text-slate-500">Town totals from completed bookings. TODA share applies only when the driver has a TODA identity.</p>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-3 pr-4 font-semibold">Town</th><th className="py-3 pr-4 font-semibold">Trips</th><th className="py-3 pr-4 font-semibold">Company</th><th className="py-3 pr-4 font-semibold">TODA</th></tr></thead>
                <tbody>
                  {scopedTrips.length === 0 ? <tr><td colSpan={4} className="py-6 text-slate-400">No rows for the selected scope.</td></tr> : scopedTrips.map((row) => (
                    <tr key={String(row.town || "Unknown (legacy data)")} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.town || "Unknown (legacy data)"}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.total_trips || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number((row.company_share_total ?? row.total_revenue) || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number(row.toda_share_total || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">Top drivers with TODA identification</h2>
            <p className="mt-1 text-sm text-slate-500">Completed trips, gross proposed fares, company share, TODA share, and quality signals.</p>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-3 pr-4 font-semibold">Driver</th><th className="py-3 pr-4 font-semibold">Town</th><th className="py-3 pr-4 font-semibold">TODA</th><th className="py-3 pr-4 font-semibold">Trips</th><th className="py-3 pr-4 font-semibold">Gross fares</th><th className="py-3 pr-4 font-semibold">Company</th><th className="py-3 pr-4 font-semibold">TODA</th><th className="py-3 pr-4 font-semibold">Avg rating</th><th className="py-3 font-semibold">Ratings</th></tr></thead>
                <tbody>
                  {scopedDrivers.length === 0 ? <tr><td colSpan={9} className="py-6 text-slate-400">No driver analytics rows for the selected scope.</td></tr> : scopedDrivers.map((row) => (
                    <tr key={String(row.driver_id || row.driver_name || Math.random())} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.driver_name || "Unknown Driver"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.municipality || "Unknown (legacy data)"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.toda_name || "-"}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.completed_trips || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number(row.gross_proposed_fare_earnings || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number((row.total_company_share ?? row.total_platform_revenue) || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPeso(Number(row.total_toda_share || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{Number(row.average_rating || 0).toFixed(2)}</td>
                      <td className="py-3 text-slate-700">{formatCount(Number(row.ratings_count || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">TODA breakdown by town</h2>
            <p className="mt-1 text-sm text-slate-500">Each TODA receives PHP 1 per completed ride when the driver is identified as a TODA member.</p>
            <div className="mt-4 space-y-4">
              {scopedTrips.map((row) => (
                <div key={`toda-${row.town || "Unknown (legacy data)"}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="font-semibold text-slate-900">{row.town || "Unknown (legacy data)"}</div>
                  <div className="mt-1 text-sm text-slate-500">TODA rides: {formatCount(Number(row.toda_completed_trips || 0))} - TODA share: {formatPeso(Number(row.toda_share_total || 0))}</div>
                  <div className="mt-3 overflow-auto">
                    <table className="min-w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-2 pr-4 font-semibold">TODA</th><th className="py-2 pr-4 font-semibold">Trips</th><th className="py-2 font-semibold">Share</th></tr></thead><tbody>
                      {Array.isArray(row.toda_breakdown) && row.toda_breakdown.length > 0 ? row.toda_breakdown.map((item, idx) => (
                        <tr key={`${row.town || "Unknown (legacy data)"}-${item.toda_name || idx}`} className="border-b border-slate-100 last:border-0"><td className="py-2 pr-4 text-slate-700">{item.toda_name || "-"}</td><td className="py-2 pr-4 text-slate-700">{formatCount(Number(item.trips || 0))}</td><td className="py-2 text-slate-700">{formatPeso(Number(item.toda_share_total || 0))}</td></tr>
                      )) : <tr><td colSpan={3} className="py-3 text-slate-400">No TODA-tagged rides in this town.</td></tr>}
                    </tbody></table>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">No-driver search demand</h2>
            <p className="mt-1 text-sm text-slate-500">Passengers who searched but were not able to get a driver. This reads from driver_search_failures only. It does not patch or infer missing rows.</p>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-3 pr-4 font-semibold">Passenger</th><th className="py-3 pr-4 font-semibold">Town</th><th className="py-3 pr-4 font-semibold">Time (PHT)</th><th className="py-3 pr-4 font-semibold">Pickup</th><th className="py-3 pr-4 font-semibold">Dropoff</th><th className="py-3 pr-4 font-semibold">Requested</th><th className="py-3 font-semibold">Alternate</th></tr></thead>
                <tbody>
                  {scopedFailures.length === 0 ? <tr><td colSpan={7} className="py-6 text-slate-400">No no-driver search rows yet in this scope. This page remains read-only and does not change booking logging behavior.</td></tr> : scopedFailures.map((row) => (
                    <tr key={String(row.id || Math.random())} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.passenger_name || "Unknown Passenger"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.town || "Unknown (legacy data)"}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatPHDateTime(row.created_at)}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.from_label || "-"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.to_label || "-"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.requested_vehicle_type || "-"}</td>
                      <td className="py-3 text-slate-700">{row.alternate_vehicle_type || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-1">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">Driver watchlist</h2>
            <p className="mt-1 text-sm text-slate-500">Low-rating watchlist for management review and partner-safe monitoring.</p>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-slate-500"><th className="py-3 pr-4 font-semibold">Driver</th><th className="py-3 pr-4 font-semibold">Town</th><th className="py-3 pr-4 font-semibold">Avg rating</th><th className="py-3 pr-4 font-semibold">Low ratings</th><th className="py-3 pr-4 font-semibold">Completed</th><th className="py-3 pr-4 font-semibold">Latest feedback</th><th className="py-3 font-semibold">Latest rating at (PHT)</th></tr></thead>
                <tbody>
                  {scopedWatch.length === 0 ? <tr><td colSpan={7} className="py-6 text-slate-400">No watchlist rows for the selected scope.</td></tr> : scopedWatch.map((row) => (
                    <tr key={String(row.driver_id || row.driver_name || Math.random())} className="border-b border-slate-100 last:border-0">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.driver_name || "Unknown Driver"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.municipality || "Unknown (legacy data)"}</td>
                      <td className="py-3 pr-4 text-slate-700">{Number(row.average_rating || 0).toFixed(2)}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.low_ratings_count || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatCount(Number(row.completed_trips || 0))}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.latest_feedback || "-"}</td>
                      <td className="py-3 text-slate-700">{formatPHDateTime(row.latest_rating_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
