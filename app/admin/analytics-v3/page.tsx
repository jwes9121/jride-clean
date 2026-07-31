"use client";

import * as React from "react";

type AnyRow = Record<string, any>;

function money(v: any) {
  const n = Number(v || 0);
  return "PHP " + n.toLocaleString("en-PH", { maximumFractionDigits: 0 });
}

function count(v: any) {
  return Number(v || 0).toLocaleString("en-PH");
}

function minutes(v: any) {
  const n = Number(v || 0);
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h <= 0) return m + "m";
  return h + "h " + m + "m";
}

function fmtDate(v: any) {
  if (!v) return "-";
  const d = new Date(String(v));
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

function pct(v: any) {
  return v == null ? "-" : Number(v).toFixed(2) + "%";
}

function hours(v: any) {
  return v == null ? "-" : Number(v).toFixed(2) + "h";
}


// Display order for incentive_qualification's policy_code keys â€” matches
// driver_incentive_policies.sort_order. Adding a 7th tier means adding one
// entry here, not a new code path.
const POLICY_ORDER: string[] = [
  "WEEKLY",
  "PHONE_CLAMP",
  "SHIRT",
  "MONTHLY",
  "THERMAL_BAG",
  "SMARTPHONE",
];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatShortDate(iso: any) {
  if (!iso) return "-";
  // Parsed manually from the YYYY-MM-DD string rather than via Date() to
  // avoid a timezone-driven off-by-one-day shift on display.
  const parts = String(iso).split("-");
  if (parts.length !== 3) return String(iso);
  const month = MONTH_ABBR[Number(parts[1]) - 1] || parts[1];
  const day = Number(parts[2]);
  return month + " " + day;
}

function formatCycleLabel(cycleNumber: any, cycleWeeks: any) {
  const n = Number(cycleNumber || 0);
  const w = Number(cycleWeeks || 0);
  if (!n || !w) return "Cycle " + cycleNumber;
  const startWeek = (n - 1) * w + 1;
  const endWeek = n * w;
  return w === 1 ? "Week " + startWeek : "Weeks " + startWeek + "-" + endWeek;
}

function RequirementRow(props: { met: boolean; label: string; value: string }) {
  return (
    <div
      className={
        "flex items-center justify-between " +
        (props.met ? "text-emerald-700" : "text-rose-700")
      }
    >
      <span>
        {props.met ? "\u2714" : "\u2716"} {props.label}
      </span>
      <span className="font-semibold">{props.value}</span>
    </div>
  );
}

function IncentiveTierCard(props: { tier: any }) {
  const t = props.tier;
  const showBookingRow = Number(t.required_booking_count || 0) > 0;
  const missedChecksDisplay =
    t.miss_check_scope === "cycle" ? t.cycle_missed_checks : t.calendar_cumulative_missed_checks;

  return (
    <div
      className={
        "rounded border p-2 text-xs " +
        (t.qualified
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-slate-50")
      }
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{t.display_name || t.policy_code}</span>
        <span className={t.qualified ? "text-emerald-700" : "text-rose-700"}>
          {t.qualified ? "Qualified" : "Not Qualified"}
        </span>
      </div>
      <div className="mt-2 space-y-0.5">
        <RequirementRow
          met={!!t.presence_requirement_met}
          label="Presence"
          value={count(t.achieved_presence_days) + " / " + count(t.required_presence_days)}
        />
        <RequirementRow
          met={!!t.hours_requirement_met}
          label="Hours"
          value={hours(t.achieved_total_hours) + " / " + hours(t.required_total_hours)}
        />
        {showBookingRow ? (
          <RequirementRow
            met={!!t.booking_requirement_met}
            label="Bookings"
            value={count(t.achieved_booking_count) + " / " + count(t.required_booking_count)}
          />
        ) : null}
        <RequirementRow
          met={!!t.duty_check_requirement_met}
          label="Missed Checks"
          value={count(missedChecksDisplay) + " / " + count(t.allowed_missed_checks)}
        />
      </div>
      <div className="mt-1 text-slate-400">
        {formatCycleLabel(t.cycle_number, t.cycle_weeks)} &middot;{" "}
        {formatShortDate(t.cycle_start)} - {formatShortDate(t.cycle_end)}
        {t.already_awarded ? (
          <span className="ml-1 font-semibold text-amber-700">Already awarded</span>
        ) : t.claimable ? (
          <span className="ml-1 font-semibold text-emerald-700">Claimable</span>
        ) : null}
      </div>
    </div>
  );
}


function Card(props: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.title}</div>
      <div className="mt-2 text-2xl font-bold text-slate-950">{props.value}</div>
      {props.sub ? <div className="mt-1 text-xs text-slate-500">{props.sub}</div> : null}
    </div>
  );
}

export default function AnalyticsV3Page() {
    const [data, setData] = React.useState<any>(null);
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [days, setDays] = React.useState(30);
  const [selectedDriverId, setSelectedDriverId] = React.useState("");
  const [driverDetail, setDriverDetail] = React.useState<any>(null);
  const [expandedBookingCode, setExpandedBookingCode] = React.useState("");
  const [selectedTown, setSelectedTown] = React.useState("");
  const [selectedDriverStatus, setSelectedDriverStatus] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");

    fetch("/api/admin/analytics/v3?days=" + days, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (!j?.ok) throw new Error(j?.error || "Failed to load analytics.");
        setData(j);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(String(e?.message || e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [days]);

  async function openDriver(driverId: string) {
    setSelectedDriverId(driverId);
    setDriverDetail(null);

    const r = await fetch(
      "/api/admin/analytics/v3?days=" + days + "&driver_id=" + encodeURIComponent(driverId),
      { cache: "no-store" }
    );
    const j = await r.json();
    setDriverDetail(j?.driver_detail || null);
  }

  const summary = data?.summary || {};
  const daily = data?.periods?.daily || [];
  const towns = data?.towns || [];
  const drivers = data?.drivers || [];
  const activeTrips = data?.active_uncompleted_trips || [];
  const townMatches = (v: any) => !selectedTown || String(v || "").toLowerCase() === selectedTown.toLowerCase();
  const filteredActiveTrips = activeTrips.filter((r: AnyRow) => townMatches(r.town));
  const filteredDrivers = drivers.filter((r: AnyRow) => townMatches(r.town) && (!selectedDriverStatus || String(r.current_status || "").toLowerCase() === selectedDriverStatus.toLowerCase()));

  const operationsAlerts = towns.flatMap((town: AnyRow) => {
    const townName = String(town.key || town.town || town.name || "Unknown");
    const townDrivers = drivers.filter((d: AnyRow) => String(d.town || "").toLowerCase() === townName.toLowerCase());
    const onlineDrivers = townDrivers.filter((d: AnyRow) => String(d.current_status || "").toLowerCase() === "online").length;
    const active = Number(town.active || town.active_uncompleted || 0);
    const total = Number(town.total || town.total_bookings || 0);
    const cancelled = Number(town.cancelled || 0);
    const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;
    const alerts: AnyRow[] = [];

    if (onlineDrivers === 0) {
      alerts.push({ level: "red", town: townName, message: "No online drivers." });
    }

    if (active > 0 && onlineDrivers < 2) {
      alerts.push({ level: "yellow", town: townName, message: `${active} active bookings with only ${onlineDrivers} online driver(s).` });
    }

    if (total >= 3 && cancellationRate >= 30) {
      alerts.push({ level: "yellow", town: townName, message: `Cancellation rate is ${cancellationRate}%.` });
    }

    return alerts;
  });

  const gpsPendingDrivers = drivers.filter((d: AnyRow) => String(d.current_status || "").toLowerCase() === "gps_pending");
  const offlineTownAlerts = operationsAlerts.filter((a: AnyRow) => a.level === "red");
  const cancellationAlerts = operationsAlerts.filter((a: AnyRow) => String(a.message || "").toLowerCase().includes("cancellation rate"));
  const actionQueue = [
    { level: offlineTownAlerts.length ? "red" : "green", label: `${offlineTownAlerts.length} town(s) with no online drivers` },
    { level: gpsPendingDrivers.length ? "yellow" : "green", label: `${gpsPendingDrivers.length} driver(s) GPS pending`, action: "gps_pending" },
    { level: cancellationAlerts.length ? "yellow" : "green", label: `${cancellationAlerts.length} town(s) with high cancellation rate` },
    { level: activeTrips.length ? "yellow" : "green", label: `${activeTrips.length} active/uncompleted trip(s)` },
  ];

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Analytics V3</h1>
          <p className="mt-1 text-sm text-slate-600">
            Canonical operations analytics using bookings.status as lifecycle source.
          </p>
        </div>

        <select
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {err ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}
      {loading ? <div className="rounded-lg bg-white p-4 text-sm shadow-sm">Loading...</div> : null}

      {data ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card title="Total bookings" value={count(summary.total_bookings)} sub={`${count(summary.completed)} completed / ${count(summary.cancelled)} cancelled`} />
            <Card title="Active uncompleted" value={count(summary.active_uncompleted)} sub={`${count(summary.ride_active)} ride / ${count(summary.takeout_active)} takeout`} />
            <Card title="Gross bookings" value={money(summary.revenue)} sub={`Company cut: ${money(summary.company_cut)}`} />
            <Card title="Drivers online" value={count(summary.online_now)} sub={`${count(summary.total_login_sessions)} login sessions`} />
          </section>



          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Action Queue</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {actionQueue.map((item: AnyRow, idx: number) => (
                <div
                  key={idx}
                  className={[
                    "rounded-lg border p-3 text-sm",
                    item.level === "red"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : item.level === "yellow"
                        ? "border-yellow-200 bg-yellow-50 text-yellow-800"
                        : "border-green-200 bg-green-50 text-green-800",
                  ].join(" ")}
                >
                  <div className="text-xs font-semibold uppercase">{item.level}</div>
                  <div className="mt-1 font-bold">{item.label}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Operations Alerts</h2>
            {operationsAlerts.length ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {operationsAlerts.map((a: AnyRow, idx: number) => (
                  <div
                    key={`${a.town}-${idx}`}
                    className={[
                      "rounded-lg border p-3 text-sm",
                      a.level === "red" ? "border-red-200 bg-red-50 text-red-800" : "border-yellow-200 bg-yellow-50 text-yellow-800",
                    ].join(" ")}
                  >
                    <div className="font-bold">{a.level === "red" ? "Red" : "Yellow"} - {a.town}</div>
                    <div className="mt-1">{a.message}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                Green - No operational alerts for the selected period.
              </div>
            )}
          </section>
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Town Operations Dashboard</h2>
            <div className="mt-3 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2">Town</th>
                    <th className="p-2">Total</th>
                    <th className="p-2">Active</th>
                    <th className="p-2">Completed</th>
                    <th className="p-2">Cancelled</th>
                    <th className="p-2">Ride</th>
                    <th className="p-2">Takeout</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.towns || []).length ? (data.towns || []).map((t: AnyRow) => (
                    <tr key={t.key || t.town || t.name} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => setSelectedTown(String(t.key || t.town || t.name || ""))}>
                      <td className="p-2 font-semibold">{t.key || t.town || t.name || "Unknown"}</td>
                      <td className="p-2">{count(t.total_bookings)}</td>
                      <td className="p-2">{count(t.active_uncompleted)}</td>
                      <td className="p-2">{count(t.completed)}</td>
                      <td className="p-2">{count(t.cancelled)}</td>
                      <td className="p-2">{count(t.ride_completed + t.ride_active)}</td>
                      <td className="p-2">{count(t.takeout_completed + t.takeout_active)}</td>
                    </tr>
                  )) : (
                    <tr><td className="p-3 text-slate-500" colSpan={7}>No town data.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selectedTown ? (
            <div className="mt-6 flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <div><span className="font-bold">Town filter:</span> {selectedTown}</div>
              <button className="rounded border border-blue-300 bg-white px-3 py-1 text-xs font-semibold" onClick={() => setSelectedTown("")}>Clear filter</button>
            </div>
          ) : null}

          {selectedDriverStatus ? (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
              <div><span className="font-bold">Driver status filter:</span> {selectedDriverStatus}</div>
              <button className="rounded border border-yellow-300 bg-white px-3 py-1 text-xs font-semibold" onClick={() => setSelectedDriverStatus("")}>Clear filter</button>
            </div>
          ) : null}

          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Active / Uncompleted Trips</h2>
            <div className="mt-3 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2">Booking</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Town</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Passenger</th>
                    <th className="p-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActiveTrips.length ? filteredActiveTrips.map((r: AnyRow) => (
                    <tr key={r.booking_code} className="border-t">
                      <td className="p-2 font-semibold">{r.booking_code}</td>
                      <td className="p-2">{r.service_type}</td>
                      <td className="p-2">{r.town || "-"}</td>
                      <td className="p-2">{r.status || "-"}</td>
                      <td className="p-2">{r.passenger_name || "-"}</td>
                      <td className="p-2">{fmtDate(r.updated_at)}</td>
                    </tr>
                  )) : (
                    <tr><td className="p-3 text-slate-500" colSpan={6}>No active uncompleted trips.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">Daily Summary</h2>
              <div className="mt-3 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-2">Date</th>
                      <th className="p-2">Total</th>
                      <th className="p-2">Completed</th>
                      <th className="p-2">Cancelled</th>
                      <th className="p-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.slice(0, 14).map((r: AnyRow) => (
                      <tr key={r.key} className="border-t">
                        <td className="p-2 font-semibold">{r.key}</td>
                        <td className="p-2">{count(r.total)}</td>
                        <td className="p-2">{count(r.completed)}</td>
                        <td className="p-2">{count(r.cancelled)}</td>
                        <td className="p-2">{money(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </section>

          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Driver Analytics</h2>
            <div className="mt-3 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2">Driver</th>
                    <th className="p-2">Town</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Completed</th>
                    <th className="p-2">Active</th>
                    <th className="p-2">Sessions</th>
                    <th className="p-2">Login Time</th>
                    <th className="p-2">Gross Bookings</th>
		    <th className="p-2">Driver Earnings</th>
                    <th className="p-2">Online Hours</th>
                    <th className="p-2">Duty Check %</th>
                    <th className="p-2">Progression %</th>
                    <th className="p-2">Completion %</th>
                    <th className="p-2">Incentive (Current Period)</th>
                    <th className="p-2">Incentive Qualification</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrivers.map((r: AnyRow) => (
                    <tr
                      key={r.driver_id}
                      className="cursor-pointer border-t hover:bg-slate-50"
                      onClick={() => openDriver(r.driver_id)}
                    >
                      <td className="p-2 font-semibold">{r.driver_name || "Unknown Driver"}</td>
                      <td className="p-2">{r.town || "-"}</td>
                      <td className="p-2">{r.current_status || "-"}</td>
                      <td className="p-2">{count(r.completed_trips)}</td>
                      <td className="p-2">{count(r.active_trips)}</td>
                      <td className="p-2">{count(r.login_sessions)}</td>
                      <td className="p-2">{minutes(r.login_minutes)}</td>
                      <td className="p-2">{money(r.gross_revenue)}</td>
		      <td className="p-2">{money(r.driver_payout)}</td>
                      <td className="p-2">{hours(r.online_hours)}</td>
                      <td className="p-2">{pct(r.duty_check_response_rate_pct)}</td>
                      <td className="p-2">{pct(r.assignment_progression_pct)}</td>
                      <td className="p-2">{pct(r.completion_pct)}</td>
                      <td className="p-2">
                        {r.incentive_period_name == null ? (
                          <span className="text-slate-400">No activity this incentive period</span>
                        ) : (
                          <div className="text-xs">
                            <div className="font-semibold">{r.incentive_period_name}</div>
                            <div className="text-slate-500">
                              {hours(r.incentive_raw_online_hours)} raw / {hours(r.incentive_eligible_online_hours)} eligible / {count(r.incentive_completed_assignments)} completed
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        {(() => {
                          const iq = r.incentive_qualification || {};
                          const tiers = POLICY_ORDER.map((code) => iq[code]).filter(Boolean);
                          if (tiers.length === 0) {
                            return <span className="text-slate-400">No activity this incentive period</span>;
                          }
                          const qualifiedCount = tiers.filter((t: any) => t.qualified).length;
                          return (
                            <div className="text-xs">
                              <div className="font-semibold text-slate-700">
                                {qualifiedCount}/{tiers.length} tiers qualified
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {tiers.map((t: any) => (
                                  <span
                                    key={t.policy_code}
                                    title={t.display_name}
                                    className={
                                      "rounded px-1.5 py-0.5 " +
                                      (t.qualified
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-slate-100 text-slate-500")
                                    }
                                  >
                                    {t.policy_code}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {selectedDriverId ? (
            <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">Driver Detail</h2>

              {!driverDetail ? (
                <div className="mt-3 text-sm text-slate-500">Loading driver detail...</div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-4">
                      {driverDetail.driver?.photo_url ? (
                        <img
                          src={driverDetail.driver.photo_url}
                          alt={driverDetail.driver?.driver_name || "Driver photo"}
                          className="h-20 w-20 rounded-full border border-slate-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-500">
                          No photo
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Driver Profile</div>
                        <div className="mt-1 text-2xl font-bold text-slate-950">{driverDetail.driver?.driver_name || "Unknown Driver"}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {driverDetail.driver?.callsign || "-"} / {driverDetail.driver?.vehicle_type || "-"} / {driverDetail.driver?.municipality || driverDetail.driver?.town || "-"}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">Phone: {driverDetail.driver?.phone || "-"}</div>
                      </div>

                      <div className="grid gap-2 text-sm md:grid-cols-5">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">Wallet</div>
                          <div className="mt-1 font-bold">{money(driverDetail.driver?.wallet_balance)}</div>
                          <div className="text-xs text-slate-500">Min: {money(driverDetail.driver?.min_wallet_required)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">Locked</div>
                          <div className="mt-1 font-bold">{driverDetail.driver?.wallet_locked ? "Yes" : "No"}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">TODA</div>
                          <div className="mt-1 font-bold">{driverDetail.driver?.is_toda_member ? "Yes" : "No"}</div>
                          <div className="text-xs text-slate-500">{driverDetail.driver?.toda_name || "-"}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">Ride Rating</div>
                          <div className="mt-1 font-bold">{driverDetail.ratings?.ride_count ? Number(driverDetail.ratings.ride_average || 0).toFixed(2) : "-"}</div>
                          <div className="text-xs text-slate-500">{driverDetail.ratings?.ride_count || 0} ratings</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">Takeout Rating</div>
                          <div className="mt-1 font-bold">{driverDetail.ratings?.takeout_count ? Number(driverDetail.ratings.takeout_average || 0).toFixed(2) : "-"}</div>
                          <div className="text-xs text-slate-500">{driverDetail.ratings?.takeout_count || 0} ratings</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Current Booking</h3>
                      {driverDetail.current_booking ? (
                        <div className="mt-2 text-sm">
                          <div className="font-semibold">{driverDetail.current_booking.booking_code}</div>
                          <div className="text-slate-500">{driverDetail.current_booking.status || "-"} / {driverDetail.current_booking.service_type || "ride"}</div>
                          <div className="text-slate-500">{driverDetail.current_booking.from_label || "-"}</div>
                          <div className="text-slate-500">{driverDetail.current_booking.to_label || "-"}</div>
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">No active booking.</div>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Current Location</h3>
                      {driverDetail.current_location ? (
                        <div className="mt-2 text-sm text-slate-600">
                          <div>Status: {driverDetail.current_location.status || "-"}</div>
                          <div>Town: {driverDetail.current_location.town || driverDetail.current_location.home_town || "-"}</div>
                          <div>Last seen: {fmtDate(driverDetail.current_location.updated_at)}</div>
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">No location row.</div>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Logged Hours</h3>
                      {(() => {
                        const logged = driverDetail.login_summary || {
  			today_minutes: 0,
  			week_minutes: 0,
  			month_minutes: 0,
  			overall_minutes: 0,
			};
                        return (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded border border-slate-200 bg-slate-50 p-2">
                              <div className="text-xs uppercase text-slate-500">Today</div>
                              <div className="font-bold">{minutes(logged.today_minutes)}</div>
                            </div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2">
                              <div className="text-xs uppercase text-slate-500">This Week</div>
                              <div className="font-bold">{minutes(logged.week_minutes)}</div>
                            </div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2">
                              <div className="text-xs uppercase text-slate-500">This Month</div>
                              <div className="font-bold">{minutes(logged.month_minutes)}</div>
                            </div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2">
                              <div className="text-xs uppercase text-slate-500">Overall</div>
                              <div className="font-bold">{minutes(logged.overall_minutes)}</div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Daily Sessions</h3>
                      <div className="mt-2 max-h-64 overflow-auto rounded border">
                        {(driverDetail.daily_login_summary || []).map((d: AnyRow) => (
                          <div key={d.date} className="grid grid-cols-4 gap-2 border-b p-2 text-sm">
                            <div className="font-semibold">{d.date || "-"}</div>
                            <div>{minutes(d.minutes)}</div>
                            <div>{count(d.sessions)} sessions</div>
                            <div className="text-xs text-slate-500">{fmtDate(d.first_login_at)} to {fmtDate(d.last_seen_at)}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Performance KPIs</h3>
                      {(() => {
                        const p = driverDetail.performance || {};
                        return (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Completed</div><div className="font-bold">{count(p.completed_bookings)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Cancelled</div><div className="font-bold">{count(p.cancelled_bookings)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Completion Rate</div><div className="font-bold">{p.completion_rate == null ? "-" : p.completion_rate + "%"}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Cancellation Rate</div><div className="font-bold">{p.cancellation_rate == null ? "-" : p.cancellation_rate + "%"}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Ride / Takeout</div><div className="font-bold">{count(p.ride_bookings)} / {count(p.takeout_bookings)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Gross Total</div><div className="font-bold">{money(p.gross_total)}</div></div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Reliability (Historical)</h3>
                      {(() => {
                        const rel = driverDetail.reliability;
                        if (!rel) {
                          return <div className="mt-2 text-sm text-slate-500">No reliability record.</div>;
                        }
                        return (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Online Hours</div><div className="font-bold">{hours(rel.online_hours)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Duty Check Response</div><div className="font-bold">{pct(rel.duty_check_response_rate_pct)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Assignment Progression</div><div className="font-bold">{pct(rel.assignment_progression_pct)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Completion</div><div className="font-bold">{pct(rel.completion_pct)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Unique Assigned Bookings</div><div className="font-bold">{count(rel.unique_assigned_bookings)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Repeat Assignments</div><div className="font-bold">{count(rel.repeated_assignment_pairs)}</div></div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Current Incentive</h3>
                      {(() => {
                        const inc = driverDetail.incentive;
                        if (!inc) {
                          return <div className="mt-2 text-sm text-slate-500">No activity this incentive period.</div>;
                        }
                        return (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div className="col-span-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
                              OBSERVATION MODE - Incentive qualification is being tracked. Rewards have not yet been activated for operational use.
                            </div>
                            <div className="col-span-2 rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Incentive Period</div><div className="font-bold">{inc.incentive_period_name || "-"}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Raw Online Hours</div><div className="font-bold">{hours(inc.raw_online_hours)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Eligible Online Hours</div><div className="font-bold">{hours(inc.eligible_online_hours)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Assigned Bookings</div><div className="font-bold">{count(inc.unique_assigned_bookings)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Completed Assignments</div><div className="font-bold">{count(inc.completed_assignments)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Duty Check Response</div><div className="font-bold">{pct(inc.duty_check_response_rate_pct)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Progression</div><div className="font-bold">{pct(inc.assignment_progression_pct)}</div></div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Completion</div><div className="font-bold">{pct(inc.completion_pct)}</div></div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Incentive Qualification</h3>
                      {(() => {
                        const iq = driverDetail.incentive_qualification || {};
                        const tiers = POLICY_ORDER.map((code) => iq[code]).filter(Boolean);
                        if (tiers.length === 0) {
                          return (
                            <div className="mt-2 text-sm text-slate-500">
                              No activity this incentive period.
                            </div>
                          );
                        }
                        return (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {tiers.map((t: any) => (
                              <IncentiveTierCard key={t.policy_code} tier={t} />
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-3">
                    <div>
                      <h3 className="font-semibold">Sessions</h3>
                      <div className="mt-2 max-h-80 overflow-auto rounded border">
                        {(driverDetail.sessions || []).map((s: AnyRow) => (
                          <div key={s.id} className="border-b p-2 text-sm">
                            <div className="font-semibold">{s.status || "-"}</div>
                            <div className="text-xs text-slate-500">{fmtDate(s.login_at)} to {s.logout_at ? fmtDate(s.logout_at) : "Online"}</div>
                            <div className="text-xs text-slate-500">{s.source || "-"} / {s.device_id || "-"}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold">Bookings</h3>
                      <div className="mt-2 max-h-80 overflow-auto rounded border">
                        {(driverDetail.bookings || []).map((b: AnyRow) => {
                          const expanded = expandedBookingCode === b.booking_code;
                          return (
                            <div
                              key={b.id || b.booking_code}
                              className="cursor-pointer border-b p-2 text-sm hover:bg-slate-50"
                              onClick={() => setExpandedBookingCode(expanded ? "" : String(b.booking_code || ""))}
                            >
                              <div className="font-semibold">{b.booking_code}</div>
                              <div className="text-xs text-slate-500">{b.service_type || "ride"} / {b.status || "-"} / {b.town || "-"}</div>
                              <div className="text-xs text-slate-500">
                                Gross: {money(Number(b.verified_fare || b.takeout_total_payable || b.proposed_fare || 0))} / Driver: {money(b.driver_payout)} / Company: {money(b.company_cut)}
                              </div>
                              <div className="text-xs text-slate-500">{fmtDate(b.created_at)}</div>

                              {expanded ? (
                                <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                                  <div>Passenger: {b.passenger_name || "-"}</div>
                                  <div>Pickup: {b.from_label || "-"}</div>
                                  <div>Dropoff: {b.to_label || "-"}</div>
                                  <div>Canonical Status: {b.status || "-"}</div>
                                  <div>Vendor Status: {b.vendor_status || "-"}</div>
                                  <div>Customer Status: {b.customer_status || "-"}</div>
                                  <div>Driver Status: {b.driver_status || "-"}</div>
                                  <div>Pricing Status: {b.takeout_pricing_status || "-"}</div>
                                  <div>Created: {fmtDate(b.created_at)}</div>
                                  <div>Updated: {fmtDate(b.updated_at)}</div>
                                  <div>Completed: {fmtDate(b.completed_at)}</div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold">Timeline</h3>
                      <div className="mt-2 max-h-80 overflow-auto rounded border">
                        {(driverDetail.timeline || []).map((t: AnyRow, idx: number) => (
                          <div key={`${t.type}-${t.at}-${idx}`} className="border-b p-2 text-sm">
                            <div className="font-semibold">{t.label || t.type}</div>
                            <div className="text-xs text-slate-500">{fmtDate(t.at)}</div>
                            <div className="text-xs text-slate-500">{t.booking_code ? `${t.booking_code} / ${t.status || "-"}` : t.status || "-"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}


