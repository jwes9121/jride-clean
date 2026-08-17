"use client";

import * as React from "react";

function count(v: any) {
  return v == null ? "-" : String(v);
}

function hours(v: any) {
  return v == null ? "-" : Number(v).toFixed(2) + "h";
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatShortDate(iso: any) {
  if (!iso) return "-";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return String(iso);
  const month = MONTH_ABBR[Number(parts[1]) - 1] || parts[1];
  const day = Number(parts[2]);
  return month + " " + day;
}

function formatCycleLabel(cycleNumber: any, cycleWeeks: any) {
  const n = Number(cycleNumber || 0);
  const w = Number(cycleWeeks || 0);
  if (!n) return "Cycle " + cycleNumber;
  if (!w) return "Cycle " + n;
  const startWeek = (n - 1) * w + 1;
  const endWeek = n * w;
  return w === 1 ? "Week " + startWeek : "Weeks " + startWeek + "-" + endWeek;
}

const POLICY_ORDER: string[] = [
  "WEEKLY",
  "PHONE_CLAMP",
  "SHIRT",
  "MONTHLY",
  "THERMAL_BAG",
  "SMARTPHONE",
];

type ClaimableRow = {
  driver_id: string;
  driver_name: string;
  policy_code: string;
  display_name: string;
  cycle_number: number;
  cycle_weeks: number;
  cycle_start: string;
  cycle_end: string;
  achieved_presence_days: number;
  required_presence_days: number;
  achieved_total_hours: number;
  required_total_hours: number;
  achieved_booking_count: number;
  required_booking_count: number;
  cycle_missed_checks: number;
  calendar_cumulative_missed_checks: number;
  allowed_missed_checks: number;
  miss_check_scope: string;
  qualified: boolean;
  already_awarded: boolean;
  claimable: boolean;
};

type AwardRecord = {
  id: string;
  driver_id: string;
  driver_name: string;
  policy_code: string;
  display_name: string;
  cycle_number: number;
  cycle_weeks: number;
  cycle_start: string;
  cycle_end: string;
  qualified: boolean;
  reward_given: boolean;
  reward_given_at: string | null;
  awarded_by: string | null;
  remarks: string | null;
  created_at: string;
};

function rowKey(r: { driver_id: string; policy_code: string; cycle_number: number }) {
  return r.driver_id + "::" + r.policy_code + "::" + r.cycle_number;
}

export default function IncentiveAwardsPage() {
  const [rows, setRows] = React.useState<ClaimableRow[]>([]);
  const [history, setHistory] = React.useState<AwardRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [policyFilter, setPolicyFilter] = React.useState("WEEKLY");
  const [cycleFilter, setCycleFilter] = React.useState("");
  const [awardingKey, setAwardingKey] = React.useState("");
  const [remarksByKey, setRemarksByKey] = React.useState<Record<string, string>>({});
  const [submittingKey, setSubmittingKey] = React.useState("");

  async function load() {
    setLoading(true);
    setErrorMessage("");
    try {
      const params = new URLSearchParams();
      params.set("only_claimable", "true");
      if (policyFilter) params.set("policy_code", policyFilter);
      const res = await fetch("/api/admin/incentive-awards?" + params.toString());
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setErrorMessage(json?.error || "Failed to load claimable incentives.");
        setRows([]);
        setHistory([]);
        return;
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setHistory(Array.isArray(json.history) ? json.history : []);
    } catch (err: any) {
      setErrorMessage(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyFilter]);

  const cycleOptions = React.useMemo(() => {
    if (!policyFilter) return [];

    const byCycle = new Map<
      number,
      {
        cycle_number: number;
        cycle_weeks: number;
        cycle_start: string;
        cycle_end: string;
      }
    >();

    for (const row of rows) {
      const cycleNumber = Number(row.cycle_number || 0);
      if (!cycleNumber) continue;
      byCycle.set(cycleNumber, {
        cycle_number: cycleNumber,
        cycle_weeks: Number(row.cycle_weeks || 0),
        cycle_start: row.cycle_start,
        cycle_end: row.cycle_end,
      });
    }

    for (const award of history) {
      const cycleNumber = Number(award.cycle_number || 0);
      if (!cycleNumber || byCycle.has(cycleNumber)) continue;
      byCycle.set(cycleNumber, {
        cycle_number: cycleNumber,
        cycle_weeks: Number(award.cycle_weeks || 0),
        cycle_start: award.cycle_start,
        cycle_end: award.cycle_end,
      });
    }

    return Array.from(byCycle.values()).sort(
      (a, b) => b.cycle_number - a.cycle_number
    );
  }, [rows, history, policyFilter]);

  React.useEffect(() => {
    if (!policyFilter) {
      if (cycleFilter) setCycleFilter("");
      return;
    }

    if (cycleOptions.length === 0) {
      if (cycleFilter) setCycleFilter("");
      return;
    }

    const stillAvailable = cycleOptions.some(
      (item) => String(item.cycle_number) === cycleFilter
    );

    if (!stillAvailable) {
      setCycleFilter(String(cycleOptions[0].cycle_number));
    }
  }, [policyFilter, cycleOptions, cycleFilter]);

  const selectedCycle =
    cycleOptions.find((item) => String(item.cycle_number) === cycleFilter) || null;

  const filteredRows = rows.filter((r) => {
    if (cycleFilter && String(r.cycle_number) !== cycleFilter) return false;
    if (!search.trim()) return true;
    return String(r.driver_name || "").toLowerCase().includes(search.trim().toLowerCase());
  });

  const filteredHistory = history.filter((a) => {
    if (cycleFilter && String(a.cycle_number) !== cycleFilter) return false;
    return true;
  });

  const groupedByDriver: Record<string, ClaimableRow[]> = {};
  for (const r of filteredRows) {
    const key = r.driver_id;
    if (!groupedByDriver[key]) groupedByDriver[key] = [];
    groupedByDriver[key].push(r);
  }
  for (const key of Object.keys(groupedByDriver)) {
    groupedByDriver[key].sort(
      (a, b) => POLICY_ORDER.indexOf(a.policy_code) - POLICY_ORDER.indexOf(b.policy_code)
    );
  }

  async function submitAward(row: ClaimableRow) {
    const key = rowKey(row);
    setSubmittingKey(key);
    setMessage("");
    setErrorMessage("");
    try {
      const res = await fetch("/api/admin/incentive-awards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "award",
          driver_id: row.driver_id,
          policy_code: row.policy_code,
          cycle_number: row.cycle_number,
          remarks: remarksByKey[key] || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setErrorMessage(
          json?.error ||
            (json?.code === "ALREADY_AWARDED"
              ? "This reward was already awarded (possibly by someone else just now)."
              : "Failed to record the award.")
        );
        await load();
        return;
      }
      setMessage(
        row.driver_name + " awarded " + row.display_name + " (" + formatCycleLabel(row.cycle_number, row.cycle_weeks) + ")."
      );
      setAwardingKey("");
      await load();
    } catch (err: any) {
      setErrorMessage(String(err?.message || err));
    } finally {
      setSubmittingKey("");
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h1 className="text-2xl font-bold text-slate-950">Driver Incentive Awards</h1>
      <p className="mt-1 text-sm text-slate-600">
        Drivers currently qualified and not yet awarded for each incentive tier. Awarding here
        records the reward permanently and cannot be undone by re-running qualification.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search driver name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          value={policyFilter}
          onChange={(e) => {
            setPolicyFilter(e.target.value);
            setCycleFilter("");
          }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All incentives</option>
          {POLICY_ORDER.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        {policyFilter ? (
          <select
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            disabled={cycleOptions.length === 0}
          >
            {cycleOptions.length === 0 ? (
              <option value="">No completed cycle</option>
            ) : (
              cycleOptions.map((item) => (
                <option key={item.cycle_number} value={String(item.cycle_number)}>
                  {formatCycleLabel(item.cycle_number, item.cycle_weeks)} Â·{" "}
                  {formatShortDate(item.cycle_start)} - {formatShortDate(item.cycle_end)}
                </option>
              ))
            )}
          </select>
        ) : null}

        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {policyFilter && selectedCycle ? (
        <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span className="font-semibold">
            Showing {policyFilter} Â·{" "}
            {formatCycleLabel(selectedCycle.cycle_number, selectedCycle.cycle_weeks)}
          </span>
          {" Â· "}
          {formatShortDate(selectedCycle.cycle_start)} - {formatShortDate(selectedCycle.cycle_end)}
          {" Â· "}
          {filteredRows.length} claimable driver{filteredRows.length === 1 ? "" : "s"}
        </div>
      ) : null}

      {message ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {Object.keys(groupedByDriver).length === 0 && !loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No drivers are currently claimable for an award.
          </div>
        ) : null}

        {Object.entries(groupedByDriver).map(([driverId, driverRows]) => (
          <div key={driverId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="font-semibold text-slate-900">{driverRows[0]?.driver_name}</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {driverRows.map((row) => {
                const key = rowKey(row);
                const isAwarding = awardingKey === key;
                const isSubmitting = submittingKey === key;
                return (
                  <div
                    key={key}
                    className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{row.display_name}</span>
                      <span className="text-emerald-700">Claimable</span>
                    </div>
                    <div className="mt-1 text-slate-600">
                      Presence {count(row.achieved_presence_days)}/{count(row.required_presence_days)}{" "}
                      &middot; Hours {hours(row.achieved_total_hours)}/{hours(row.required_total_hours)}
                      {Number(row.required_booking_count || 0) > 0 ? (
                        <>
                          {" "}
                          &middot; Bookings {count(row.achieved_booking_count)}/{count(row.required_booking_count)}
                        </>
                      ) : null}
                      {" "}
                      &middot; Missed checks{" "}
                      {row.miss_check_scope === "cycle"
                        ? count(row.cycle_missed_checks)
                        : count(row.calendar_cumulative_missed_checks)}
                      /{count(row.allowed_missed_checks)}
                    </div>
                    <div className="mt-1 text-slate-400">
                      {formatCycleLabel(row.cycle_number, row.cycle_weeks)} &middot;{" "}
                      {formatShortDate(row.cycle_start)} - {formatShortDate(row.cycle_end)}
                    </div>

                    {isAwarding ? (
                      <div className="mt-2 space-y-1">
                        <textarea
                          placeholder="Optional remarks..."
                          value={remarksByKey[key] || ""}
                          onChange={(e) =>
                            setRemarksByKey((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          className="w-full rounded border border-slate-300 p-1 text-xs"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => submitAward(row)}
                            className="rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {isSubmitting ? "Awarding..." : "Confirm Award"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAwardingKey("")}
                            className="rounded border border-slate-300 px-2 py-1 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAwardingKey(key)}
                        className="mt-2 rounded bg-slate-950 px-2 py-1 text-xs font-semibold text-white"
                      >
                        Award
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-bold text-slate-950">Recent Awards</h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">Driver</th>
              <th className="p-2">Incentive</th>
              <th className="p-2">Cycle</th>
              <th className="p-2">Awarded At</th>
              <th className="p-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-400" colSpan={5}>
                  No awards recorded yet.
                </td>
              </tr>
            ) : (
              filteredHistory.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="p-2">{a.driver_name}</td>
                  <td className="p-2">{a.display_name || a.policy_code}</td>
                  <td className="p-2">
                    {formatCycleLabel(a.cycle_number, a.cycle_weeks)} &middot;{" "}
                    {formatShortDate(a.cycle_start)} - {formatShortDate(a.cycle_end)}
                  </td>
                  <td className="p-2">
                    {a.reward_given_at ? new Date(a.reward_given_at).toLocaleString() : "-"}
                  </td>
                  <td className="p-2 text-slate-500">{a.remarks || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
