"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type TabKey = "overview" | "absentees" | "raffle-winners";
type SortDirection = "asc" | "desc";
type BatchSortKey =
  | "groupValue"
  | "registered"
  | "checkedIn"
  | "absent"
  | "disqualified";

type EventDetails = {
  eventId: string;
  title: string;
  shortName: string | null;
  slug: string;
  eventDate: string | null;
  venue: string | null;
  groupLabel: string | null;
  status: string;
};

type AttendanceBreakdown = {
  registered: number;
  checkedIn: number;
  absent: number;
};

type AttendanceSummary = {
  alumni: AttendanceBreakdown;
  guests: AttendanceBreakdown;
  total: AttendanceBreakdown & {
    disqualified: number;
    attendanceRate: number;
  };
};

type BatchSummaryRow = {
  groupValue: string | null;
  registered: number;
  checkedIn: number;
  absent: number;
  disqualified: number;
};

type AbsenteeRow = {
  attendeeId: string;
  attendeeType: string;
  fullName: string;
  mobileNumber: string | null;
  groupValue: string | null;
  registrationNumber: string;
  registrationSource: string | null;
  registeredAt: string | null;
};

type RaffleWinnerRow = {
  winnerId: string;
  status: string;
  claimedAt: string | null;
  draw: {
    drawId: string;
    drawName: string;
    drawType: string;
  };
  attendee: {
    attendeeId: string;
    fullName: string;
    groupValue: string | null;
    registrationNumber: string;
  };
};

type ReportsResponse = {
  success?: boolean;
  error?: string;
  event: EventDetails;
  summary: AttendanceSummary;
  batchSummary: BatchSummaryRow[];
  absentees: AbsenteeRow[];
  raffleWinners: RaffleWinnerRow[];
};

const TAB_ITEMS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "absentees", label: "Absentees" },
  { key: "raffle-winners", label: "Raffle Winners" },
];

function formatEventDate(value: string | null): string {
  if (!value) return "Date not available";

  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(parsed);
}

function formatLabel(value: string | null | undefined): string {
  const text = String(value || "").trim();

  if (!text) return "-";

  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function safeCount(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function compareText(left: string | null, right: string | null): number {
  return String(left || "").localeCompare(String(right || ""), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
      {helper ? <p className="mt-2 text-sm text-slate-500">{helper}</p> : null}
    </div>
  );
}

function SortButton({
  active,
  direction,
  children,
  onClick,
}: {
  active: boolean;
  direction: SortDirection;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-left font-black text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
    >
      <span>{children}</span>
      <span aria-hidden="true" className="text-xs text-slate-400">
        {active ? (direction === "asc" ? "ASC" : "DESC") : "SORT"}
      </span>
    </button>
  );
}

export default function EventReportsPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [activeTab, setActiveTab] = React.useState<TabKey>("overview");
  const [data, setData] = React.useState<ReportsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);

  const [batchSortKey, setBatchSortKey] =
    React.useState<BatchSortKey>("groupValue");
  const [batchSortDirection, setBatchSortDirection] =
    React.useState<SortDirection>("asc");

  const [absenteeSearch, setAbsenteeSearch] = React.useState("");
  const [absenteeBatch, setAbsenteeBatch] = React.useState("");

  React.useEffect(() => {
    if (!eventSlug) return;

    const controller = new AbortController();

    async function loadReports() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/events/${encodeURIComponent(
            eventSlug
          )}/reports/attendance-summary`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const payload = (await response.json()) as ReportsResponse;

        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || "Unable to load attendance reports.");
        }

        if (
          !payload.event ||
          !payload.summary ||
          !Array.isArray(payload.batchSummary) ||
          !Array.isArray(payload.absentees) ||
          !Array.isArray(payload.raffleWinners)
        ) {
          throw new Error("Attendance reports API returned incomplete data.");
        }

        setData(payload);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }

        setData(null);
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load attendance reports."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadReports();

    return () => controller.abort();
  }, [eventSlug, refreshKey]);

  const groupLabel = data?.event.groupLabel || "Batch";

  const batchOptions = React.useMemo(() => {
    if (!data) return [];

    return Array.from(
      new Set(
        data.absentees
          .map((row) => String(row.groupValue || "").trim())
          .filter(Boolean)
      )
    ).sort((left, right) => compareText(left, right));
  }, [data]);

  const sortedBatchSummary = React.useMemo(() => {
    const rows = [...(data?.batchSummary || [])];

    rows.sort((left, right) => {
      let result = 0;

      if (batchSortKey === "groupValue") {
        result = compareText(left.groupValue, right.groupValue);
      } else {
        result =
          safeCount(left[batchSortKey]) - safeCount(right[batchSortKey]);
      }

      return batchSortDirection === "asc" ? result : -result;
    });

    return rows;
  }, [data, batchSortDirection, batchSortKey]);

  const filteredAbsentees = React.useMemo(() => {
    const query = absenteeSearch.trim().toLowerCase();

    return (data?.absentees || []).filter((row) => {
      const matchesSearch =
        !query ||
        row.fullName.toLowerCase().includes(query) ||
        row.registrationNumber.toLowerCase().includes(query) ||
        String(row.mobileNumber || "").toLowerCase().includes(query);

      const matchesBatch =
        !absenteeBatch ||
        String(row.groupValue || "").trim() === absenteeBatch;

      return matchesSearch && matchesBatch;
    });
  }, [absenteeBatch, absenteeSearch, data]);

  function changeBatchSort(nextKey: BatchSortKey) {
    if (nextKey === batchSortKey) {
      setBatchSortDirection((current) =>
        current === "asc" ? "desc" : "asc"
      );
      return;
    }

    setBatchSortKey(nextKey);
    setBatchSortDirection("asc");
  }

  function exportAbsentees() {
    if (!data) return;

    const rows: string[][] = [
      [
        groupLabel,
        "Registration Number",
        "Name",
        "Mobile",
        "Registration Source",
        "Registered At",
      ],
      ...filteredAbsentees.map((row) => [
        row.groupValue || "",
        row.registrationNumber,
        row.fullName,
        row.mobileNumber || "",
        formatLabel(row.registrationSource),
        formatDateTime(row.registeredAt),
      ]),
    ];

    const slug = data.event.slug || eventSlug || "event";
    downloadCsv(`${slug}-absentees.csv`, rows);
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="bg-slate-950 px-4 py-6 text-white shadow-xl sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                JRide Events Reports
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
                {data?.event.title || "Attendance Reports"}
              </h1>
              <p className="mt-2 text-base text-slate-300">
                {data?.event.shortName || "Live event attendance and raffle reporting"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setRefreshKey((current) => current + 1)}
              disabled={loading}
              className="min-h-12 rounded-xl bg-amber-400 px-5 py-3 text-base font-black text-slate-950 shadow-sm hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Refreshing..." : "Refresh Reports"}
            </button>
          </div>

          {data ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
                  Event Date
                </p>
                <p className="mt-2 text-lg font-black">
                  {formatEventDate(data.event.eventDate)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 sm:col-span-1 lg:col-span-2">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
                  Venue
                </p>
                <p className="mt-2 text-lg font-black">
                  {data.event.venue || "Venue not available"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
                  Event Status
                </p>
                <p className="mt-2 text-lg font-black">
                  {formatLabel(data.event.status)}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div
          className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
          role="tablist"
          aria-label="Event reports"
        >
          {TAB_ITEMS.map((tab) => {
            const selected = activeTab === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.key)}
                className={`min-h-12 whitespace-nowrap rounded-xl px-5 py-3 text-base font-black ${
                  selected
                    ? "bg-slate-950 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-lg font-black text-slate-800">
              Loading attendance reports...
            </p>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-6 shadow-sm">
            <p className="text-lg font-black text-red-900">
              Reports could not be loaded
            </p>
            <p className="mt-2 text-red-800">{error}</p>
            <button
              type="button"
              onClick={() => setRefreshKey((current) => current + 1)}
              className="mt-5 min-h-12 rounded-xl bg-red-700 px-5 py-3 font-black text-white hover:bg-red-600"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !error && data && activeTab === "overview" ? (
          <div className="mt-6 space-y-6">
            <section>
              <h2 className="text-2xl font-black text-slate-950">
                Alumni Attendance
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard
                  label="Alumni Registered"
                  value={safeCount(data.summary.alumni.registered)}
                />
                <MetricCard
                  label="Alumni Checked In"
                  value={safeCount(data.summary.alumni.checkedIn)}
                />
                <MetricCard
                  label="Alumni Absent"
                  value={safeCount(data.summary.alumni.absent)}
                />
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-black text-slate-950">
                Guest Attendance
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard
                  label="Guests Registered"
                  value={safeCount(data.summary.guests.registered)}
                />
                <MetricCard
                  label="Guests Checked In"
                  value={safeCount(data.summary.guests.checkedIn)}
                />
                <MetricCard
                  label="Guests Absent"
                  value={safeCount(data.summary.guests.absent)}
                />
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-black text-slate-950">
                Event Totals
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <MetricCard
                  label="Total Registered"
                  value={safeCount(data.summary.total.registered)}
                />
                <MetricCard
                  label="Total Checked In"
                  value={safeCount(data.summary.total.checkedIn)}
                />
                <MetricCard
                  label="Total Absent"
                  value={safeCount(data.summary.total.absent)}
                />
                <MetricCard
                  label="Disqualified"
                  value={safeCount(data.summary.total.disqualified)}
                />
                <MetricCard
                  label="Attendance Rate"
                  value={`${safeCount(data.summary.total.attendanceRate)}%`}
                  helper="Value returned by the reports API"
                />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5 sm:p-6">
                <h2 className="text-2xl font-black text-slate-950">
                  {groupLabel} Attendance
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Select a column heading to sort the actual report counts.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full border-collapse">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200">
                      {[
                        ["groupValue", groupLabel],
                        ["registered", "Registered"],
                        ["checkedIn", "Checked In"],
                        ["absent", "Absent"],
                        ["disqualified", "Disqualified"],
                      ].map(([key, label]) => (
                        <th
                          key={key}
                          scope="col"
                          className="px-4 py-3 text-left text-sm"
                        >
                          <SortButton
                            active={batchSortKey === key}
                            direction={batchSortDirection}
                            onClick={() =>
                              changeBatchSort(key as BatchSortKey)
                            }
                          >
                            {label}
                          </SortButton>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBatchSummary.length > 0 ? (
                      sortedBatchSummary.map((row, index) => (
                        <tr
                          key={`${row.groupValue || "unassigned"}-${index}`}
                          className="border-b border-slate-100 last:border-b-0"
                        >
                          <td className="px-5 py-4 font-black text-slate-900">
                            {row.groupValue || "Unassigned"}
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            {safeCount(row.registered)}
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            {safeCount(row.checkedIn)}
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            {safeCount(row.absent)}
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            {safeCount(row.disqualified)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-5 py-10 text-center text-slate-500"
                        >
                          No {groupLabel.toLowerCase()} attendance rows are available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}

        {!loading && !error && data && activeTab === "absentees" ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5 sm:p-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h2 className="text-2xl font-black text-slate-950">
                    Absentees
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Showing {filteredAbsentees.length} of {data.absentees.length} records.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={exportAbsentees}
                  className="min-h-12 rounded-xl bg-amber-400 px-5 py-3 font-black text-slate-950 hover:bg-amber-300"
                >
                  Export CSV
                </button>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-slate-700">
                    Search
                  </span>
                  <input
                    type="search"
                    value={absenteeSearch}
                    onChange={(event) => setAbsenteeSearch(event.target.value)}
                    placeholder="Name, registration number, or mobile"
                    className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-black text-slate-700">
                    {groupLabel} Filter
                  </span>
                  <select
                    value={absenteeBatch}
                    onChange={(event) => setAbsenteeBatch(event.target.value)}
                    className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  >
                    <option value="">All {groupLabel}s</option>
                    {batchOptions.map((batch) => (
                      <option key={batch} value={batch}>
                        {batch}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1100px] w-full border-collapse">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    {[
                      groupLabel,
                      "Registration Number",
                      "Name",
                      "Mobile",
                      "Registration Source",
                      "Registered At",
                    ].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-5 py-4 text-left text-sm font-black uppercase tracking-[0.08em] text-slate-600"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAbsentees.length > 0 ? (
                    filteredAbsentees.map((row) => (
                      <tr
                        key={row.attendeeId}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="px-5 py-4 font-black text-slate-900">
                          {row.groupValue || "Unassigned"}
                        </td>
                        <td className="px-5 py-4 font-mono text-sm text-slate-700">
                          {row.registrationNumber}
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-900">
                          {row.fullName}
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          {row.mobileNumber || "-"}
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          {formatLabel(row.registrationSource)}
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          {formatDateTime(row.registeredAt)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-12 text-center text-slate-500"
                      >
                        No absentee records match the current search and filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!loading && !error && data && activeTab === "raffle-winners" ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5 sm:p-6">
              <h2 className="text-2xl font-black text-slate-950">
                Raffle Winners
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {data.raffleWinners.length} winner record
                {data.raffleWinners.length === 1 ? "" : "s"} returned by the reports API.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full border-collapse">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    {["Draw", "Winner", groupLabel, "Status", "Claimed At"].map(
                      (heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-5 py-4 text-left text-sm font-black uppercase tracking-[0.08em] text-slate-600"
                        >
                          {heading}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.raffleWinners.length > 0 ? (
                    data.raffleWinners.map((row) => (
                      <tr
                        key={row.winnerId}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="px-5 py-4">
                          <p className="font-black text-slate-900">
                            {row.draw.drawName}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {formatLabel(row.draw.drawType)}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-bold text-slate-900">
                            {row.attendee.fullName}
                          </p>
                          <p className="mt-1 font-mono text-xs text-slate-500">
                            {row.attendee.registrationNumber}
                          </p>
                        </td>
                        <td className="px-5 py-4 font-black text-slate-900">
                          {row.attendee.groupValue || "Unassigned"}
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-sm font-black text-slate-800">
                            {formatLabel(row.status)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          {formatDateTime(row.claimedAt)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-5 py-12 text-center text-slate-500"
                      >
                        No raffle winner records are available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <footer className="mt-8 border-t border-slate-300 py-6 text-sm text-slate-500">
          Powered by JRide Corporation. JRide Events Platform.
        </footer>
      </section>
    </main>
  );
}
