"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

type AdminTab =
  | "attendees"
  | "operations"
  | "reports"
  | "raffle"
  | "status";

type AttendanceBreakdown = {
  registered: number;
  checkedIn: number;
  absent: number;
};

type ReportEvent = {
  eventId: string;
  title: string;
  shortName: string | null;
  slug: string;
  eventDate: string | null;
  venue: string | null;
  groupLabel: string | null;
  status: string;
  primaryAttendeeTypeKey: string;
  primaryAttendeeTypeLabel: string;
  guestAttendeeTypeLabel: string | null;
};

type AttendeeTypeSummary = {
  attendeeTypeId: string;
  typeKey: string;
  typeLabel: string;
  isPrimary: boolean;
  registered: number;
  checkedIn: number;
  absent: number;
  disqualified: number;
};

type ReportsResponse = {
  success?: boolean;
  error?: string;
  event: ReportEvent;
  summary: {
    primary: AttendanceBreakdown;
    alumni?: AttendanceBreakdown;
    guests: AttendanceBreakdown;
    other: AttendanceBreakdown;
    total: AttendanceBreakdown & {
      disqualified: number;
      attendanceRate: number;
    };
  };
  attendeeTypeSummary: AttendeeTypeSummary[];
  batchSummary: Array<{
    groupValue: string | null;
    registered: number;
    checkedIn: number;
    absent: number;
    disqualified: number;
  }>;
  absentees: Array<{
    attendeeId: string;
    attendeeType: string;
    attendeeTypeLabel: string;
    fullName: string;
    mobileNumber: string | null;
    groupValue: string | null;
    registrationNumber: string;
    registrationSource: string | null;
    registeredAt: string | null;
  }>;
  raffleWinners: Array<{
    winnerId: string;
    status: string;
    claimedAt: string | null;
    draw: {
      drawId: string;
      drawName: string;
      drawType: string;
    } | null;
    attendee: {
      attendeeId: string;
      fullName: string;
      groupValue: string | null;
      registrationNumber: string;
    } | null;
  }>;
};

const HelpDeskPage = dynamic(
  () => import("../../../events/[eventSlug]/help-desk/page"),
  {
    ssr: false,
    loading: () => <PanelLoading label="Loading attendee controls..." />,
  }
);

const CommandCenterPage = dynamic(
  () => import("../../../events/[eventSlug]/command-center/page"),
  {
    ssr: false,
    loading: () => <PanelLoading label="Loading live operations..." />,
  }
);

const RafflePage = dynamic(
  () => import("../../../events/[eventSlug]/raffle/page"),
  {
    ssr: false,
    loading: () => <PanelLoading label="Loading raffle controls..." />,
  }
);

const LifecyclePage = dynamic(() => import("./lifecycle/page"), {
  ssr: false,
  loading: () => <PanelLoading label="Loading event status..." />,
});

const TABS: Array<{
  key: AdminTab;
  label: string;
  helper: string;
}> = [
  {
    key: "attendees",
    label: "Attendees",
    helper: "Search, edit, passes, walk-ins",
  },
  {
    key: "operations",
    label: "Live Operations",
    helper: "Check-in and checkpoint monitoring",
  },
  {
    key: "reports",
    label: "Reports",
    helper: "Attendance, absentees, raffle winners",
  },
  {
    key: "raffle",
    label: "Raffle",
    helper: "Draw and claim controls",
  },
  {
    key: "status",
    label: "Event Status",
    helper: "Lifecycle transitions",
  },
];

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
        {label}
      </div>
    </div>
  );
}

function formatLabel(value: string | null | undefined) {
  const text = String(value || "").trim();

  if (!text) return "-";

  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatEventDate(value: string | null) {
  if (!value) return "Date not available";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
) {
  const encode = (value: string | number | null | undefined) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csv = [
    headers.map(encode).join(","),
    ...rows.map((row) => row.map(encode).join(",")),
  ].join("\r\n");

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

function Metric({
  label,
  value,
  helper,
}: {
  label: string;
  value: number | string;
  helper?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
      {helper ? (
        <p className="mt-2 text-xs leading-5 text-slate-500">{helper}</p>
      ) : null}
    </div>
  );
}

function ReportsPanel({ eventSlug }: { eventSlug: string }) {
  const [data, setData] = React.useState<ReportsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [section, setSection] = React.useState<
    "overview" | "absentees" | "raffle"
  >("overview");
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (!eventSlug) return;

    const controller = new AbortController();

    async function load() {
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
          throw new Error(payload.error || "Unable to load event reports.");
        }

        if (
          !payload.event ||
          !payload.summary ||
          !Array.isArray(payload.absentees) ||
          !Array.isArray(payload.raffleWinners)
        ) {
          throw new Error("Reports API returned incomplete data.");
        }

        setData(payload);
      } catch (caught) {
        if (
          caught instanceof DOMException &&
          caught.name === "AbortError"
        ) {
          return;
        }

        setData(null);
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load event reports."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [eventSlug, refreshKey]);

  const filteredAbsentees = React.useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return data?.absentees || [];

    return (data?.absentees || []).filter((row) =>
      [
        row.fullName,
        row.registrationNumber,
        row.mobileNumber || "",
        row.groupValue || "",
        row.attendeeTypeLabel,
      ].some((value) => value.toLowerCase().includes(query))
    );
  }, [data, search]);

  if (loading) {
    return <PanelLoading label="Loading reports..." />;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-2xl border border-red-300 bg-red-50 p-6 text-red-900">
          <p className="text-xl font-black">Reports could not be loaded</p>
          <p className="mt-2">{error}</p>
          <button
            type="button"
            onClick={() => setRefreshKey((current) => current + 1)}
            className="mt-4 rounded-xl bg-red-900 px-4 py-3 font-black text-white"
          >
            Retry Reports
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const primaryLabel =
    data.event.primaryAttendeeTypeLabel || "Primary Attendees";
  const groupLabel = data.event.groupLabel || "Group";

  return (
    <div className="bg-slate-100 px-4 py-6 text-slate-950">
      <section className="mx-auto max-w-7xl">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                Event Reports
              </p>
              <h2 className="mt-2 text-3xl font-black">
                {data.event.title}
              </h2>
              <p className="mt-2 text-slate-300">
                {formatEventDate(data.event.eventDate)}
                {data.event.venue ? ` | ${data.event.venue}` : ""}
                {` | ${formatLabel(data.event.status)}`}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setRefreshKey((current) => current + 1)}
              className="rounded-xl bg-amber-300 px-4 py-3 font-black text-slate-950"
            >
              Refresh Reports
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {[
            ["overview", "Overview"],
            ["absentees", `Absentees (${data.absentees.length})`],
            ["raffle", `Raffle Winners (${data.raffleWinners.length})`],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setSection(
                  key as "overview" | "absentees" | "raffle"
                )
              }
              className={`rounded-xl px-4 py-3 text-sm font-black ${
                section === key
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {section === "overview" ? (
          <div className="mt-5 space-y-6">
            <section>
              <h3 className="text-xl font-black">
                {primaryLabel} Attendance
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <Metric
                  label={`${primaryLabel} Registered`}
                  value={data.summary.primary.registered}
                />
                <Metric
                  label={`${primaryLabel} Checked In`}
                  value={data.summary.primary.checkedIn}
                />
                <Metric
                  label={`${primaryLabel} Absent`}
                  value={data.summary.primary.absent}
                />
              </div>
            </section>

            <section>
              <h3 className="text-xl font-black">Whole Event</h3>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Metric
                  label="All Registered"
                  value={data.summary.total.registered}
                />
                <Metric
                  label="All Checked In"
                  value={data.summary.total.checkedIn}
                />
                <Metric
                  label="All Absent"
                  value={data.summary.total.absent}
                />
                <Metric
                  label="Disqualified"
                  value={data.summary.total.disqualified}
                />
                <Metric
                  label="Attendance Rate"
                  value={`${data.summary.total.attendanceRate}%`}
                />
              </div>
            </section>

            {data.attendeeTypeSummary.length > 0 ? (
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <h3 className="text-xl font-black">
                    Attendance by Registration Type
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.1em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Registered</th>
                        <th className="px-4 py-3">Checked In</th>
                        <th className="px-4 py-3">Absent</th>
                        <th className="px-4 py-3">Disqualified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.attendeeTypeSummary.map((row) => (
                        <tr
                          key={row.attendeeTypeId}
                          className="border-t border-slate-100"
                        >
                          <td className="px-4 py-3 font-bold">
                            {row.typeLabel}
                            {row.isPrimary ? (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-900">
                                PRIMARY
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">{row.registered}</td>
                          <td className="px-4 py-3">{row.checkedIn}</td>
                          <td className="px-4 py-3">{row.absent}</td>
                          <td className="px-4 py-3">
                            {row.disqualified}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {data.batchSummary.length > 0 ? (
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <h3 className="text-xl font-black">
                    {groupLabel} Summary
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Primary attendee totals grouped by {groupLabel}.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.1em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3">{groupLabel}</th>
                        <th className="px-4 py-3">Registered</th>
                        <th className="px-4 py-3">Checked In</th>
                        <th className="px-4 py-3">Absent</th>
                        <th className="px-4 py-3">Disqualified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.batchSummary.map((row) => (
                        <tr
                          key={row.groupValue || "unknown"}
                          className="border-t border-slate-100"
                        >
                          <td className="px-4 py-3 font-bold">
                            {row.groupValue || "Unknown"}
                          </td>
                          <td className="px-4 py-3">{row.registered}</td>
                          <td className="px-4 py-3">{row.checkedIn}</td>
                          <td className="px-4 py-3">{row.absent}</td>
                          <td className="px-4 py-3">
                            {row.disqualified}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {section === "absentees" ? (
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-xl font-black">Absentees</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Registered attendees who are not checked in and are not
                  disqualified.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    `${data.event.slug}-absentees.csv`,
                    [
                      "Type",
                      groupLabel,
                      "Registration Number",
                      "Name",
                      "Mobile",
                      "Registration Source",
                      "Registered At",
                    ],
                    filteredAbsentees.map((row) => [
                      row.attendeeTypeLabel,
                      row.groupValue,
                      row.registrationNumber,
                      row.fullName,
                      row.mobileNumber,
                      formatLabel(row.registrationSource),
                      formatDateTime(row.registeredAt),
                    ])
                  )
                }
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black"
              >
                Export CSV
              </button>
            </div>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, pass, mobile, type, or group..."
              className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3"
            />

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.1em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Pass</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">{groupLabel}</th>
                    <th className="px-4 py-3">Mobile</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAbsentees.map((row) => (
                    <tr
                      key={row.attendeeId}
                      className="border-t border-slate-100"
                    >
                      <td className="px-4 py-3">
                        {row.attendeeTypeLabel}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold">
                        {row.registrationNumber}
                      </td>
                      <td className="px-4 py-3 font-bold">
                        {row.fullName}
                      </td>
                      <td className="px-4 py-3">
                        {row.groupValue || "-"}
                      </td>
                      <td className="px-4 py-3">
                        {row.mobileNumber || "-"}
                      </td>
                    </tr>
                  ))}
                  {filteredAbsentees.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        No matching absentees.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {section === "raffle" ? (
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-xl font-black">Raffle Winners</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.1em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Draw</th>
                    <th className="px-4 py-3">Winner</th>
                    <th className="px-4 py-3">Pass</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Claimed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.raffleWinners.map((row) => (
                    <tr
                      key={row.winnerId}
                      className="border-t border-slate-100"
                    >
                      <td className="px-4 py-3 font-bold">
                        {row.draw?.drawName || "-"}
                      </td>
                      <td className="px-4 py-3">
                        {row.attendee?.fullName || "-"}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {row.attendee?.registrationNumber || "-"}
                      </td>
                      <td className="px-4 py-3">
                        {formatLabel(row.status)}
                      </td>
                      <td className="px-4 py-3">
                        {formatDateTime(row.claimedAt)}
                      </td>
                    </tr>
                  ))}
                  {data.raffleWinners.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        No raffle winners recorded yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}

export default function EventAdminControlPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");
  const [activeTab, setActiveTab] =
    React.useState<AdminTab>("attendees");

  React.useEffect(() => {
    const requested = new URLSearchParams(
      window.location.search
    ).get("tab") as AdminTab | null;

    if (requested && TABS.some((tab) => tab.key === requested)) {
      setActiveTab(requested);
    }
  }, []);

  function selectTab(tab: AdminTab) {
    setActiveTab(tab);

    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const activeDefinition =
    TABS.find((tab) => tab.key === activeTab) || TABS[0];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950 px-4 py-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                JRide Events
              </p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">
                Event Admin Control
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                Event:{" "}
                <span className="font-mono text-slate-200">
                  {eventSlug}
                </span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={`/events/${eventSlug}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-200"
              >
                Open Public Event
              </a>
              <a
                href={`/events/${eventSlug}/register`}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-amber-400 px-4 py-3 text-sm font-black text-amber-300"
              >
                Open Registration
              </a>
            </div>
          </div>

          <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {TABS.map((tab) => {
              const selected = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => selectTab(tab.key)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected
                      ? "border-amber-300 bg-amber-300 text-slate-950"
                      : "border-slate-800 bg-slate-900 text-white hover:border-slate-600"
                  }`}
                >
                  <p className="font-black">{tab.label}</p>
                  <p
                    className={`mt-1 text-xs leading-5 ${
                      selected
                        ? "text-slate-700"
                        : "text-slate-400"
                    }`}
                  >
                    {tab.helper}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">
            <span className="font-black text-white">
              {activeDefinition.label}:
            </span>{" "}
            {activeDefinition.helper}.
          </div>
        </div>
      </header>

      {activeTab === "attendees" ? <HelpDeskPage /> : null}
      {activeTab === "operations" ? <CommandCenterPage /> : null}
      {activeTab === "reports" ? (
        <ReportsPanel eventSlug={eventSlug} />
      ) : null}
      {activeTab === "raffle" ? <RafflePage /> : null}
      {activeTab === "status" ? <LifecyclePage /> : null}
    </div>
  );
}
