"use client";

import * as React from "react";

type AnyRow = Record<string, any>;

const POLICY_ORDER = [
  "WEEKLY",
  "PHONE_CLAMP",
  "SHIRT",
  "MONTHLY",
  "THERMAL_BAG",
  "SMARTPHONE",
];

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function money(v: any) {
  const value = Number(v || 0);
  return "PHP " + value.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function count(v: any) {
  return Number(v || 0).toLocaleString("en-PH");
}

function minutes(v: any) {
  const value = Math.max(0, Math.round(Number(v || 0)));
  const h = Math.floor(value / 60);
  const m = value % 60;
  if (h <= 0) return m + "m";
  return h + "h " + m + "m";
}

function hours(v: any) {
  return Number(v || 0).toFixed(2) + "h";
}

function pct(v: any) {
  return v == null ? "-" : Number(v).toFixed(2) + "%";
}

function fmtDate(v: any) {
  if (!v) return "-";
  const d = new Date(String(v));
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

function formatShortDate(iso: any) {
  if (!iso) return "-";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return String(iso);
  const month = MONTH_ABBR[Number(parts[1]) - 1] || parts[1];
  return month + " " + Number(parts[2]);
}

function formatCycleLabel(cycleNumber: any, cycleWeeks: any) {
  const n = Number(cycleNumber || 0);
  const w = Number(cycleWeeks || 0);
  if (!n || !w) return "Cycle " + cycleNumber;
  const startWeek = (n - 1) * w + 1;
  const endWeek = n * w;
  return w === 1 ? "Week " + startWeek : "Weeks " + startWeek + "-" + endWeek;
}

function Card(props: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {props.title}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-950">{props.value}</div>
      {props.sub ? <div className="mt-1 text-xs text-slate-500">{props.sub}</div> : null}
    </div>
  );
}

function RequirementRow(props: { met: boolean; label: string; value: string }) {
  return (
    <div
      className={
        "flex items-center justify-between gap-3 " +
        (props.met ? "text-emerald-700" : "text-rose-700")
      }
    >
      <span>{props.met ? "PASS" : "FAIL"} - {props.label}</span>
      <span className="font-semibold">{props.value}</span>
    </div>
  );
}

function IncentiveTierCard(props: { tier: any }) {
  const t = props.tier;
  const showBookingRow = Number(t.required_booking_count || 0) > 0;
  const missedChecksDisplay =
    t.miss_check_scope === "cycle"
      ? t.cycle_missed_checks
      : t.calendar_cumulative_missed_checks;

  return (
    <div
      className={
        "rounded-lg border p-3 text-xs " +
        (t.qualified
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-slate-50")
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{t.display_name || t.policy_code}</span>
        <span className={t.qualified ? "text-emerald-700" : "text-rose-700"}>
          {t.qualified ? "Qualified" : "Not qualified"}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <RequirementRow
          met={!!t.presence_requirement_met}
          label="Presence"
          value={count(t.achieved_presence_days) + " / " + count(t.required_presence_days)}
        />
        <RequirementRow
          met={!!t.hours_requirement_met}
          label="Net hours"
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
          label="Missed checks"
          value={count(missedChecksDisplay) + " / " + count(t.allowed_missed_checks)}
        />
      </div>
      <div className="mt-2 text-slate-500">
        {formatCycleLabel(t.cycle_number, t.cycle_weeks)} - {formatShortDate(t.cycle_start)} to{" "}
        {formatShortDate(t.cycle_end)}
        {t.already_awarded ? " - Already awarded" : t.claimable ? " - Claimable" : ""}
      </div>
    </div>
  );
}

function observedTownMinutes(value: any) {
  if (!Array.isArray(value) || value.length === 0) return "-";
  return value
    .map((row: AnyRow) => String(row?.town || "Unresolved") + ": " + count(row?.minute_count) + "m")
    .join(", ");
}

export default function AnalyticsV3Page() {
  const [data, setData] = React.useState<any>(null);
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [days, setDays] = React.useState(30);
  const [selectedTown, setSelectedTown] = React.useState("");
  const [selectedDriverId, setSelectedDriverId] = React.useState("");
  const [driverDetail, setDriverDetail] = React.useState<any>(null);
  const [locationObservation, setLocationObservation] = React.useState<any>(null);
  const [locationObservationErr, setLocationObservationErr] = React.useState("");
  const [locationObservationLoading, setLocationObservationLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");

    fetch("/api/admin/analytics/v3?days=" + days, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.message || payload?.error || "Failed to load Analytics V3.");
        }
        return payload;
      })
      .then((payload) => {
        if (alive) setData(payload);
      })
      .catch((error) => {
        if (alive) setErr(String(error?.message || error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [days]);

  React.useEffect(() => {
    let alive = true;
    setLocationObservationLoading(true);
    setLocationObservationErr("");

    fetch("/api/admin/analytics/v3/location-observation", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message || payload?.error || "Failed to load location observations."
          );
        }
        return payload;
      })
      .then((payload) => {
        if (alive) setLocationObservation(payload);
      })
      .catch((error) => {
        if (alive) setLocationObservationErr(String(error?.message || error));
      })
      .finally(() => {
        if (alive) setLocationObservationLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  async function openDriver(driverId: string) {
    setSelectedDriverId(driverId);
    setDriverDetail(null);
    const response = await fetch(
      "/api/admin/analytics/v3?days=" + days + "&driver_id=" + encodeURIComponent(driverId),
      { cache: "no-store" }
    );
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      setErr(payload?.message || payload?.error || "Failed to load driver detail.");
      return;
    }
    setDriverDetail(payload.driver_detail || null);
  }

  const summary = data?.summary || {};
  const daily = data?.periods?.daily || [];
  const towns = data?.towns || [];
  const drivers = data?.drivers || [];
  const activeTrips = data?.active_uncompleted_trips || [];
  const quality = data?.data_quality || {};
  const locationObservationDrivers = Array.isArray(locationObservation?.drivers)
    ? locationObservation.drivers
    : [];

  const townMatches = (value: any) =>
    !selectedTown || String(value || "").toLowerCase() === selectedTown.toLowerCase();
  const filteredDrivers = drivers.filter((row: AnyRow) => townMatches(row.town));
  const filteredActiveTrips = activeTrips.filter((row: AnyRow) => townMatches(row.town));

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Analytics V3</h1>
          <p className="mt-1 text-sm text-slate-600">
            Production-only reporting with Manila calendar dates and security-adjusted driver hours.
          </p>
        </div>
        <select
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 Manila days</option>
          <option value={30}>Last 30 Manila days</option>
          <option value={90}>Last 90 Manila days</option>
        </select>
      </div>

      {err ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}
      {loading ? (
        <div className="rounded-lg bg-white p-4 text-sm shadow-sm">Loading Analytics V3...</div>
      ) : null}

      {data ? (
        <>
          <section className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
            <div className="font-bold">Canonical interpretation</div>
            <div className="mt-1">
              Net login hours = raw observed presence - Duty Check frozen time. Stale open sessions do not grow indefinitely.
            </div>
            <div className="mt-2 grid gap-1 text-xs md:grid-cols-2 xl:grid-cols-4">
              <div>Timezone: {quality.timezone || "Asia/Manila"}</div>
              <div>Fresh online cutoff: {count(quality.location_freshness_seconds)} seconds</div>
              <div>Dummy drivers excluded: {count(quality.dummy_driver_identities_excluded)}</div>
              <div>Dummy passengers excluded: {count(quality.dummy_passenger_identities_excluded)}</div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card
              title="Production bookings"
              value={count(summary.total_bookings)}
              sub={
                count(summary.completed) + " completed / " +
                count(summary.cancelled) + " cancelled / " +
                count(summary.active_uncompleted) + " active"
              }
            />
            <Card
              title="Completed gross"
              value={money(summary.completed_gross)}
              sub={
                "Completed company cut: " + money(summary.company_cut) +
                " / settled: " + money(summary.settled_company_cut)
              }
            />
            <Card
              title="Net driver login"
              value={minutes(summary.total_login_minutes)}
              sub={
                "Raw: " + hours(summary.total_raw_online_hours) +
                " / security deducted: " + hours(summary.total_security_excluded_hours)
              }
            />
            <Card
              title="Fresh drivers online"
              value={count(summary.online_now)}
              sub="Requires an online-like status and location fresh within 120 seconds"
            />
          </section>

          <section className="mt-5 grid gap-4 md:grid-cols-3">
            <Card
              title="Ride"
              value={count(summary.ride_completed) + " completed"}
              sub={count(summary.ride_active) + " active"}
            />
            <Card
              title="Takeout"
              value={count(summary.takeout_completed) + " completed"}
              sub={count(summary.takeout_active) + " active"}
            />
            <Card
              title="Errand"
              value={count(summary.errand_completed) + " completed"}
              sub={count(summary.errand_active) + " active"}
            />
          </section>

          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Town Operations</h2>
                <p className="text-xs text-slate-500">Click a town to filter drivers and active trips.</p>
              </div>
              {selectedTown ? (
                <button
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold"
                  onClick={() => setSelectedTown("")}
                >
                  Clear {selectedTown}
                </button>
              ) : null}
            </div>
            <div className="mt-3 overflow-auto">
              <table className="w-full min-w-[950px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2">Town</th>
                    <th className="p-2">Total</th>
                    <th className="p-2">Active</th>
                    <th className="p-2">Completed</th>
                    <th className="p-2">Cancelled</th>
                    <th className="p-2">Ride</th>
                    <th className="p-2">Takeout</th>
                    <th className="p-2">Errand</th>
                    <th className="p-2">Completed Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {towns.map((row: AnyRow) => (
                    <tr
                      key={row.key}
                      className="cursor-pointer border-t hover:bg-slate-50"
                      onClick={() => setSelectedTown(String(row.key || ""))}
                    >
                      <td className="p-2 font-semibold">{row.key || "Unknown"}</td>
                      <td className="p-2">{count(row.total)}</td>
                      <td className="p-2">{count(row.active)}</td>
                      <td className="p-2">{count(row.completed)}</td>
                      <td className="p-2">{count(row.cancelled)}</td>
                      <td className="p-2">{count(row.ride_total)}</td>
                      <td className="p-2">{count(row.takeout_total)}</td>
                      <td className="p-2">{count(row.errand_total)}</td>
                      <td className="p-2">{money(row.completed_gross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">Daily Production Summary</h2>
              <div className="mt-3 overflow-auto">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-2">Manila Date</th>
                      <th className="p-2">Total</th>
                      <th className="p-2">Completed</th>
                      <th className="p-2">Cancelled</th>
                      <th className="p-2">Active</th>
                      <th className="p-2">Completed Gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.slice(0, 31).map((row: AnyRow) => (
                      <tr key={row.key} className="border-t">
                        <td className="p-2 font-semibold">{row.key}</td>
                        <td className="p-2">{count(row.total)}</td>
                        <td className="p-2">{count(row.completed)}</td>
                        <td className="p-2">{count(row.cancelled)}</td>
                        <td className="p-2">{count(row.active)}</td>
                        <td className="p-2">{money(row.completed_gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">Active / Uncompleted Trips</h2>
              <div className="mt-3 max-h-[430px] overflow-auto">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-2">Booking</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Town</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActiveTrips.length ? (
                      filteredActiveTrips.map((row: AnyRow) => (
                        <tr key={row.booking_code} className="border-t">
                          <td className="p-2 font-semibold">{row.booking_code}</td>
                          <td className="p-2">{row.service_type}</td>
                          <td className="p-2">{row.town || "-"}</td>
                          <td className="p-2">{row.status || "-"}</td>
                          <td className="p-2">{fmtDate(row.updated_at)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="p-3 text-slate-500" colSpan={5}>
                          No active production trips for this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Driver Analytics</h2>
            <p className="mt-1 text-xs text-slate-500">
              Net Login is the value used for operational interpretation. Raw and Security Deducted are shown for audit.
            </p>
            <div className="mt-3 overflow-auto">
              <table className="w-full min-w-[1750px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2">Driver</th>
                    <th className="p-2">Town</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Completed</th>
                    <th className="p-2">Active</th>
                    <th className="p-2">Net Login</th>
                    <th className="p-2">Raw Login</th>
                    <th className="p-2">Security Deducted</th>
                    <th className="p-2">Completed Gross</th>
                    <th className="p-2">Driver Payout</th>
                    <th className="p-2">Duty Check</th>
                    <th className="p-2">Current Incentive Net</th>
                    <th className="p-2">Incentive Deducted</th>
                    <th className="p-2">Qualification</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrivers.map((row: AnyRow) => {
                    const iq = row.incentive_qualification || {};
                    const tiers = POLICY_ORDER.map((code) => iq[code]).filter(Boolean);
                    const qualifiedCount = tiers.filter((tier: AnyRow) => tier.qualified).length;
                    return (
                      <tr
                        key={row.driver_id}
                        className="cursor-pointer border-t hover:bg-slate-50"
                        onClick={() => openDriver(row.driver_id)}
                      >
                        <td className="p-2 font-semibold">{row.driver_name || "Unknown Driver"}</td>
                        <td className="p-2">{row.town || "-"}</td>
                        <td className="p-2">
                          <div className="font-semibold">{row.current_status || "offline"}</div>
                          {row.raw_location_status && row.raw_location_status !== row.current_status ? (
                            <div className="text-xs text-amber-700">
                              raw={row.raw_location_status}, stale={row.location_is_fresh ? "no" : "yes"}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2">{count(row.completed_trips)}</td>
                        <td className="p-2">{count(row.active_trips)}</td>
                        <td className="p-2 font-bold">{hours(row.online_hours)}</td>
                        <td className="p-2">{hours(row.raw_online_hours)}</td>
                        <td className="p-2 text-amber-700">{hours(row.security_excluded_hours)}</td>
                        <td className="p-2">{money(row.gross_revenue)}</td>
                        <td className="p-2">{money(row.driver_payout)}</td>
                        <td className="p-2">{pct(row.duty_check_response_rate_pct)}</td>
                        <td className="p-2 font-semibold">{hours(row.incentive_eligible_online_hours)}</td>
                        <td className="p-2 text-amber-700">{hours(row.incentive_security_excluded_hours)}</td>
                        <td className="p-2">
                          {tiers.length ? qualifiedCount + "/" + tiers.length + " tiers" : "No current tier data"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {selectedDriverId ? (
            <section className="mt-6 rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Driver Detail</h2>
                <button
                  className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold"
                  onClick={() => {
                    setSelectedDriverId("");
                    setDriverDetail(null);
                  }}
                >
                  Close
                </button>
              </div>

              {!driverDetail ? (
                <div className="mt-3 text-sm text-slate-500">Loading driver detail...</div>
              ) : (
                <div className="mt-4 space-y-5">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-4">
                      {driverDetail.driver?.photo_url ? (
                        <img
                          src={driverDetail.driver.photo_url}
                          alt={driverDetail.driver?.driver_name || "Driver photo"}
                          className="h-20 w-20 rounded-full border border-slate-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded-full border bg-white text-xs text-slate-500">
                          No photo
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold uppercase text-slate-500">Driver Profile</div>
                        <div className="mt-1 text-2xl font-bold">
                          {driverDetail.driver?.driver_name || "Unknown Driver"}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          {driverDetail.driver?.callsign || "-"} / {driverDetail.driver?.vehicle_type || "-"} /{" "}
                          {driverDetail.driver?.municipality || driverDetail.driver?.town || "-"}
                        </div>
                        <div className="text-sm text-slate-600">Phone: {driverDetail.driver?.phone || "-"}</div>
                      </div>
                      <div className="grid gap-2 text-sm md:grid-cols-3">
                        <div className="rounded-lg border bg-white p-3">
                          <div className="text-xs uppercase text-slate-500">Wallet</div>
                          <div className="font-bold">{money(driverDetail.driver?.wallet_balance)}</div>
                        </div>
                        <div className="rounded-lg border bg-white p-3">
                          <div className="text-xs uppercase text-slate-500">Ride Rating</div>
                          <div className="font-bold">
                            {driverDetail.ratings?.ride_count
                              ? Number(driverDetail.ratings.ride_average || 0).toFixed(2)
                              : "-"}
                          </div>
                        </div>
                        <div className="rounded-lg border bg-white p-3">
                          <div className="text-xs uppercase text-slate-500">Takeout Rating</div>
                          <div className="font-bold">
                            {driverDetail.ratings?.takeout_count
                              ? Number(driverDetail.ratings.takeout_average || 0).toFixed(2)
                              : "-"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Net Logged Hours</h3>
                      {(() => {
                        const logged = driverDetail.login_summary || {};
                        const rows = [
                          ["Today", logged.today_minutes, logged.today_raw_minutes, logged.today_security_excluded_minutes],
                          ["This Week", logged.week_minutes, logged.week_raw_minutes, logged.week_security_excluded_minutes],
                          ["This Month", logged.month_minutes, logged.month_raw_minutes, logged.month_security_excluded_minutes],
                          ["Overall", logged.overall_minutes, logged.overall_raw_minutes, logged.overall_security_excluded_minutes],
                        ];
                        return (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {rows.map(([label, net, raw, excluded]) => (
                              <div key={String(label)} className="rounded border bg-slate-50 p-3 text-sm">
                                <div className="text-xs uppercase text-slate-500">{label}</div>
                                <div className="mt-1 text-lg font-bold">{minutes(net)}</div>
                                <div className="text-xs text-slate-500">
                                  Raw {minutes(raw)} - Security {minutes(excluded)}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Performance - Selected Period</h3>
                      {(() => {
                        const p = driverDetail.performance || {};
                        return (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded border bg-slate-50 p-2">Completed: <b>{count(p.completed_bookings)}</b></div>
                            <div className="rounded border bg-slate-50 p-2">Cancelled: <b>{count(p.cancelled_bookings)}</b></div>
                            <div className="rounded border bg-slate-50 p-2">Completion: <b>{p.completion_rate == null ? "-" : p.completion_rate + "%"}</b></div>
                            <div className="rounded border bg-slate-50 p-2">Cancellation: <b>{p.cancellation_rate == null ? "-" : p.cancellation_rate + "%"}</b></div>
                            <div className="rounded border bg-slate-50 p-2">Ride: <b>{count(p.ride_bookings)}</b></div>
                            <div className="rounded border bg-slate-50 p-2">Takeout: <b>{count(p.takeout_bookings)}</b></div>
                            <div className="rounded border bg-slate-50 p-2">Errand: <b>{count(p.errand_bookings)}</b></div>
                            <div className="rounded border bg-slate-50 p-2">Completed gross: <b>{money(p.gross_total)}</b></div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Historical Presence and Reliability</h3>
                      {(() => {
                        const rel = driverDetail.reliability || {};
                        return (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded border bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Raw Hours</div><b>{hours(rel.raw_online_hours)}</b></div>
                            <div className="rounded border bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Security Deducted</div><b>{hours(rel.security_excluded_hours)}</b></div>
                            <div className="rounded border bg-emerald-50 p-2"><div className="text-xs uppercase text-slate-500">Net Hours</div><b>{hours(rel.online_hours)}</b></div>
                            <div className="rounded border bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Duty Check</div><b>{pct(rel.duty_check_response_rate_pct)}</b></div>
                            <div className="rounded border bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Progression</div><b>{pct(rel.assignment_progression_pct)}</b></div>
                            <div className="rounded border bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Completion</div><b>{pct(rel.completion_pct)}</b></div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <h3 className="font-semibold">Current Incentive Presence</h3>
                      {(() => {
                        const inc = driverDetail.incentive || {};
                        return (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div className="col-span-2 rounded border bg-slate-50 p-2">
                              <div className="text-xs uppercase text-slate-500">Period</div>
                              <b>{inc.incentive_period_name || "-"}</b>
                            </div>
                            <div className="rounded border bg-slate-50 p-2"><div className="text-xs uppercase text-slate-500">Raw Hours</div><b>{hours(inc.raw_online_hours)}</b></div>
                            <div className="rounded border bg-amber-50 p-2"><div className="text-xs uppercase text-slate-500">Security Deducted</div><b>{hours(inc.security_excluded_hours)}</b></div>
                            <div className="col-span-2 rounded border bg-emerald-50 p-2"><div className="text-xs uppercase text-slate-500">Eligible Net Hours</div><b>{hours(inc.eligible_online_hours)}</b></div>
                            <div className="rounded border bg-slate-50 p-2">Assigned: <b>{count(inc.unique_assigned_bookings)}</b></div>
                            <div className="rounded border bg-slate-50 p-2">Completed: <b>{count(inc.completed_assignments)}</b></div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 p-3">
                    <h3 className="font-semibold">Daily Presence Audit</h3>
                    <div className="mt-2 max-h-80 overflow-auto rounded border">
                      {(driverDetail.daily_login_summary || []).map((row: AnyRow) => (
                        <div key={row.date} className="grid gap-2 border-b p-2 text-sm md:grid-cols-6">
                          <div className="font-semibold">{row.date}</div>
                          <div>Net {minutes(row.minutes)}</div>
                          <div>Raw {minutes(row.raw_minutes)}</div>
                          <div className="text-amber-700">Security {minutes(row.security_excluded_minutes)}</div>
                          <div>{count(row.sessions)} session starts</div>
                          <div className="text-xs text-slate-500">{fmtDate(row.first_login_at)} to {fmtDate(row.last_seen_at)}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 p-3">
                    <h3 className="font-semibold">Incentive Qualification</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {(() => {
                        const iq = driverDetail.incentive_qualification || {};
                        const tiers = POLICY_ORDER.map((code) => iq[code]).filter(Boolean);
                        if (!tiers.length) {
                          return <div className="text-sm text-slate-500">No current qualification rows.</div>;
                        }
                        return tiers.map((tier: AnyRow) => (
                          <IncentiveTierCard key={tier.policy_code} tier={tier} />
                        ));
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <section className="mt-6 rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Driver Location Observation</h2>
                <p className="mt-1 text-sm font-semibold text-blue-800">
                  Observation only. Location observations do not directly add driver login hours.
                </p>
              </div>
              {locationObservation?.period ? (
                <div className="text-right text-xs text-slate-500">
                  <div className="font-semibold text-slate-700">
                    {locationObservation.period.name || "Current incentive period"}
                  </div>
                  <div>
                    {fmtDate(locationObservation.period.start_at)} to{" "}
                    {locationObservation.period.end_at ? fmtDate(locationObservation.period.end_at) : "Open"}
                  </div>
                </div>
              ) : null}
            </div>

            {locationObservationErr ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {locationObservationErr}
              </div>
            ) : locationObservationLoading ? (
              <div className="mt-3 text-sm text-slate-500">Loading location observations...</div>
            ) : locationObservationDrivers.length === 0 ? (
              <div className="mt-3 text-sm text-slate-500">No location observation data.</div>
            ) : (
              <div className="mt-3 overflow-auto">
                <table className="w-full min-w-[1350px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-2">Driver</th>
                      <th className="p-2">Registered Town</th>
                      <th className="p-2">Observed Town Minutes</th>
                      <th className="p-2">Online Minutes</th>
                      <th className="p-2">Fresh GPS Minutes</th>
                      <th className="p-2">GPS Coverage</th>
                      <th className="p-2">Same Town</th>
                      <th className="p-2">Different Town</th>
                      <th className="p-2">Not Evaluable</th>
                      <th className="p-2">Last Observed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationObservationDrivers.map((row: AnyRow) => (
                      <tr key={row.driver_id} className="border-t align-top">
                        <td className="p-2 font-semibold">{row.driver_name || "Unknown Driver"}</td>
                        <td className="p-2">{row.current_registered_town || "-"}</td>
                        <td className="max-w-sm p-2">{observedTownMinutes(row.observed_town_minutes)}</td>
                        <td className="p-2">{count(row.online_minute_count)}</td>
                        <td className="p-2">{count(row.online_with_fresh_gps_minute_count)}</td>
                        <td className="p-2">{pct(row.location_coverage_pct)}</td>
                        <td className="p-2">{count(row.same_registered_town_minute_count)}</td>
                        <td className="p-2">{count(row.different_registered_town_minute_count)}</td>
                        <td className="p-2">{count(row.town_not_evaluable_minute_count)}</td>
                        <td className="p-2">{fmtDate(row.last_observed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
