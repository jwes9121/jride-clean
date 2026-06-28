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
                  {activeTrips.length ? activeTrips.map((r: AnyRow) => (
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

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">Town Summary</h2>
              <div className="mt-3 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-2">Town</th>
                      <th className="p-2">Ride</th>
                      <th className="p-2">Takeout</th>
                      <th className="p-2">Completed</th>
                      <th className="p-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {towns.map((r: AnyRow) => (
                      <tr key={r.key} className="border-t">
                        <td className="p-2 font-semibold">{r.key}</td>
                        <td className="p-2">{count(r.ride_total)}</td>
                        <td className="p-2">{count(r.takeout_total)}</td>
                        <td className="p-2">{count(r.completed)}</td>
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
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((r: AnyRow) => (
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
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Driver Profile
                        </div>
                        <div className="mt-1 text-2xl font-bold text-slate-950">
                          {driverDetail.driver?.driver_name || "Unknown Driver"}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          {driverDetail.driver?.callsign || "-"} / {driverDetail.driver?.vehicle_type || "-"} / {driverDetail.driver?.municipality || driverDetail.driver?.town || "-"}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          Phone: {driverDetail.driver?.phone || "-"}
                        </div>
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
                          <div className="mt-1 font-bold">
                            {driverDetail.ratings?.ride_count ? Number(driverDetail.ratings.ride_average || 0).toFixed(2) : "-"}
                          </div>
                          <div className="text-xs text-slate-500">{driverDetail.ratings?.ride_count || 0} ratings</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">Takeout Rating</div>
                          <div className="mt-1 font-bold">
                            {driverDetail.ratings?.takeout_count ? Number(driverDetail.ratings.takeout_average || 0).toFixed(2) : "-"}
                          </div>
                          <div className="text-xs text-slate-500">{driverDetail.ratings?.takeout_count || 0} ratings</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
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
                  </div>

                  <div className="grid gap-4 xl:grid-cols-3">
                    <div>
                      <h3 className="font-semibold">Sessions</h3>
                      <div className="mt-2 max-h-80 overflow-auto rounded border">
                        {(driverDetail.sessions || []).map((s: AnyRow) => (
                          <div key={s.id} className="border-b p-2 text-sm">
                            <div className="font-semibold">{s.status || "-"}</div>
                            <div className="text-xs text-slate-500">
                              {fmtDate(s.login_at)} to {s.logout_at ? fmtDate(s.logout_at) : "Online"}
                            </div>
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
                              <div className="text-xs text-slate-500">
                                {b.service_type || "ride"} / {b.status || "-"} / {b.town || "-"}
                              </div>
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
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold">Timeline</h3>
                      <div className="mt-2 max-h-80 overflow-auto rounded border">
                        {(driverDetail.timeline || []).map((t: AnyRow, idx: number) => (
                          <div key={`${t.type}-${t.at}-${idx}`} className="border-b p-2 text-sm">
                            <div className="font-semibold">{t.label || t.type}</div>
                            <div className="text-xs text-slate-500">{fmtDate(t.at)}</div>
                            <div className="text-xs text-slate-500">
                              {t.booking_code ? `${t.booking_code} / ${t.status || "-"}` : t.status || "-"}
                            </div>
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