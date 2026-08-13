"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

type AdminTab =
  | "attendees"
  | "groups"
  | "operations"
  | "reports"
  | "raffle"
  | "status";

type AttendanceBreakdown = {
  records: number;
  registered: number;
  checkedIn: number;
  absent: number;
  disqualified: number;
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
  records: number;
  registered: number;
  checkedIn: number;
  absent: number;
  disqualified: number;
};

type GroupSummaryRow = {
  groupValue: string | null;
  records: number;
  registered: number;
  checkedIn: number;
  absent: number;
  disqualified: number;
};

type CompanionRelationship = {
  attendeeId: string;
  fullName: string;
  registrationNumber: string;
  groupValue: string | null;
  relationship: string | null;
};

type RegistrantRow = {
  attendeeId: string;
  attendeeType: string;
  attendeeTypeLabel: string;
  fullName: string;
  mobileNumber: string | null;
  groupValue: string | null;
  registrationNumber: string;
  registrationSource: string | null;
  registrationStatus: string | null;
  attendanceStatus: string | null;
  checkedInAt: string | null;
  isDisqualified: boolean;
  disqualificationReason: string | null;
  companionOf: CompanionRelationship | null;
  companions: CompanionRelationship[];
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
      attendanceRate: number;
    };
  };
  attendeeTypeSummary: AttendeeTypeSummary[];
  batchSummary: GroupSummaryRow[];
  groupSummary: GroupSummaryRow[];
  registrants: RegistrantRow[];
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
    companionOf: CompanionRelationship | null;
    companions: CompanionRelationship[];
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
    key: "groups",
    label: "Registration Groups",
    helper: "Batch 2001, Golden Jubilarians, regular, guests",
  },
  {
    key: "operations",
    label: "Live Operations",
    helper: "Check-in and checkpoint monitoring",
  },
  {
    key: "reports",
    label: "Reports",
    helper: "Eligible attendance, absentees, exclusions, raffle",
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

function groupDisplayLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "batch_2001_member") return "Batch 2001 Members";
  if (normalized === "golden_jubilarian") return "Golden Jubilarians";
  if (normalized === "regular_participant") return "Regular Participants";
  if (normalized === "guest") return "Guests";

  return formatLabel(value);
}

function CompanionContextCell({
  companionOf,
  companions,
}: {
  companionOf: CompanionRelationship | null;
  companions: CompanionRelationship[];
}) {
  if (companionOf) {
    return (
      <div className="min-w-[220px]">
        <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-800">
          COMPANION
        </span>
        <div className="mt-2 font-bold text-slate-900">
          Of {companionOf.fullName}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {groupDisplayLabel(companionOf.groupValue)}
          {companionOf.relationship
            ? ` | ${companionOf.relationship}`
            : ""}
        </div>
        <div className="mt-1 font-mono text-[11px] text-slate-400">
          {companionOf.registrationNumber}
        </div>
      </div>
    );
  }

  if (companions.length > 0) {
    return (
      <div className="min-w-[220px]">
        <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-black text-sky-800">
          PRIMARY
        </span>
        <div className="mt-2 text-xs font-bold text-slate-700">
          {companions.length === 1 ? "Companion:" : "Companions:"}
        </div>
        <div className="mt-1 space-y-1 text-xs text-slate-600">
          {companions.map((companion) => (
            <div key={companion.attendeeId}>
              <span className="font-bold">{companion.fullName}</span>
              {companion.relationship
                ? ` (${companion.relationship})`
                : ""}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return <span className="text-slate-400">-</span>;
}

function registrationFormPath(
  eventSlug: string,
  groupValue: string | null | undefined
) {
  const normalized = String(groupValue || "").trim().toLowerCase();

  if (normalized === "batch_2001_member") {
    return `/events/${eventSlug}/register/batch-2001`;
  }

  if (normalized === "golden_jubilarian") {
    return `/events/${eventSlug}/register/golden-jubilarian`;
  }

  if (normalized === "regular_participant") {
    return `/events/${eventSlug}/register`;
  }

  return null;
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

function useEventReports(eventSlug: string) {
  const [data, setData] = React.useState<ReportsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [refreshKey, setRefreshKey] = React.useState(0);

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
          !Array.isArray(payload.attendeeTypeSummary) ||
          !Array.isArray(payload.batchSummary) ||
          !Array.isArray(payload.groupSummary) ||
          !Array.isArray(payload.registrants) ||
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

  return {
    data,
    loading,
    error,
    refresh: () => setRefreshKey((current) => current + 1),
  };
}

function RegistrationGroupsPanel({
  eventSlug,
}: {
  eventSlug: string;
}) {
  const { data, loading, error, refresh } = useEventReports(eventSlug);
  const [selectedGroup, setSelectedGroup] = React.useState("");
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (!data || selectedGroup) return;

    const golden = data.groupSummary.find(
      (row) =>
        String(row.groupValue || "").toLowerCase() ===
        "golden_jubilarian"
    );

    const first = golden || data.groupSummary[0];

    if (first?.groupValue) {
      setSelectedGroup(first.groupValue);
    }
  }, [data, selectedGroup]);

  const selectedSummary = React.useMemo(
    () =>
      data?.groupSummary.find(
        (row) => String(row.groupValue || "") === selectedGroup
      ) || null,
    [data, selectedGroup]
  );

  const selectedRegistrants = React.useMemo(() => {
    const query = search.trim().toLowerCase();

    return (data?.registrants || [])
      .filter(
        (row) =>
          String(row.groupValue || "") === selectedGroup
      )
      .filter((row) => {
        if (!query) return true;

        return [
          row.fullName,
          row.registrationNumber,
          row.mobileNumber || "",
          row.attendeeTypeLabel,
          row.registrationStatus || "",
          row.attendanceStatus || "",
          row.disqualificationReason || "",
          row.companionOf?.fullName || "",
          row.companionOf?.registrationNumber || "",
          row.companionOf?.groupValue || "",
          row.companionOf?.relationship || "",
          ...row.companions.flatMap((companion) => [
            companion.fullName,
            companion.registrationNumber,
            companion.groupValue || "",
            companion.relationship || "",
          ]),
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) =>
        left.registrationNumber.localeCompare(
          right.registrationNumber,
          undefined,
          { numeric: true }
        )
      );
  }, [data, search, selectedGroup]);

  if (loading) {
    return <PanelLoading label="Loading registration groups..." />;
  }

  if (error) {
    return (
      <div className="bg-slate-100 px-4 py-8 text-slate-950">
        <div className="mx-auto max-w-7xl rounded-2xl border border-red-300 bg-red-50 p-6">
          <p className="text-xl font-black text-red-900">
            Registration groups could not be loaded
          </p>
          <p className="mt-2 text-red-800">{error}</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-4 rounded-xl bg-red-900 px-4 py-3 font-black text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const registrationPath = registrationFormPath(
    data.event.slug,
    selectedSummary?.groupValue
  );

  return (
    <div className="bg-slate-100 px-4 py-6 text-slate-950">
      <section className="mx-auto max-w-7xl">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                Registration Groups
              </p>
              <h2 className="mt-2 text-3xl font-black">
                {data.event.title}
              </h2>
              <p className="mt-2 text-slate-300">
                Open each registration stream and review every record,
                eligible attendee, and exclusion from one place.
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              className="rounded-xl bg-amber-300 px-4 py-3 font-black text-slate-950"
            >
              Refresh Groups
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.groupSummary.map((row) => {
            const groupKey = String(row.groupValue || "");
            const selected = groupKey === selectedGroup;

            return (
              <button
                key={groupKey || "unknown"}
                type="button"
                onClick={() => {
                  setSelectedGroup(groupKey);
                  setSearch("");
                }}
                className={`rounded-2xl border p-5 text-left shadow-sm ${
                  selected
                    ? "border-amber-400 bg-amber-100"
                    : "border-slate-200 bg-white hover:border-slate-400"
                }`}
              >
                <p className="text-lg font-black">
                  {groupDisplayLabel(row.groupValue)}
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-2xl font-black">{row.records}</p>
                    <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                      Records
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-emerald-700">
                      {row.registered}
                    </p>
                    <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                      Eligible
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-red-700">
                      {row.disqualified}
                    </p>
                    <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                      Excluded
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {selectedSummary ? (
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                  Selected Registration Group
                </p>
                <h3 className="mt-2 text-2xl font-black">
                  {groupDisplayLabel(selectedSummary.groupValue)}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  {selectedSummary.records} total records |{" "}
                  {selectedSummary.registered} eligible |{" "}
                  {selectedSummary.disqualified} excluded
                </p>
              </div>

              {registrationPath ? (
                <a
                  href={registrationPath}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white"
                >
                  Open {groupDisplayLabel(selectedSummary.groupValue)} Registration
                </a>
              ) : null}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Metric
                label="Total Records"
                value={selectedSummary.records}
              />
              <Metric
                label="Eligible Registered"
                value={selectedSummary.registered}
              />
              <Metric
                label="Checked In"
                value={selectedSummary.checkedIn}
              />
              <Metric
                label="Absent"
                value={selectedSummary.absent}
              />
              <Metric
                label="Excluded"
                value={selectedSummary.disqualified}
              />
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Use the <strong>Attendees</strong> tab for editing, pass
              reissue, exclusion, or restoring eligibility. Search by the
              pass number shown below.
            </div>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search this group by name, pass, mobile, or status..."
              className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-3"
            />

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.1em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Pass</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Companion / Primary</th>
                    <th className="px-4 py-3">Eligibility</th>
                    <th className="px-4 py-3">Attendance</th>
                    <th className="px-4 py-3">Mobile</th>
                    <th className="px-4 py-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRegistrants.map((row) => (
                    <tr
                      key={row.attendeeId}
                      className="border-t border-slate-100"
                    >
                      <td className="px-4 py-3 font-mono font-bold">
                        {row.registrationNumber}
                      </td>
                      <td className="px-4 py-3 font-bold">
                        {row.fullName}
                      </td>
                      <td className="px-4 py-3">
                        {row.attendeeTypeLabel}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <CompanionContextCell
                          companionOf={row.companionOf}
                          companions={row.companions}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {row.isDisqualified ? (
                          <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-black text-red-800">
                            EXCLUDED
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-800">
                            ELIGIBLE
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {formatLabel(row.attendanceStatus)}
                      </td>
                      <td className="px-4 py-3">
                        {row.mobileNumber || "-"}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-slate-500">
                        {row.disqualificationReason || "-"}
                      </td>
                    </tr>
                  ))}
                  {selectedRegistrants.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        No matching records in this registration group.
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

function ReportsPanel({ eventSlug }: { eventSlug: string }) {
  const { data, loading, error, refresh } = useEventReports(eventSlug);
  const [section, setSection] = React.useState<
    "overview" | "absentees" | "raffle"
  >("overview");
  const [search, setSearch] = React.useState("");

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
        row.companionOf?.fullName || "",
        row.companionOf?.registrationNumber || "",
        row.companionOf?.groupValue || "",
        row.companionOf?.relationship || "",
        ...row.companions.flatMap((companion) => [
          companion.fullName,
          companion.registrationNumber,
          companion.groupValue || "",
          companion.relationship || "",
        ]),
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
            onClick={refresh}
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
              onClick={refresh}
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
                  label={`Eligible ${primaryLabel}`}
                  value={data.summary.primary.registered}
                  helper={`${data.summary.primary.records} total records; ${data.summary.primary.disqualified} excluded`}
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
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                <Metric
                  label="Eligible Registered"
                  value={data.summary.total.registered}
                  helper="Excludes disqualified/test registrations"
                />
                <Metric
                  label="Checked In"
                  value={data.summary.total.checkedIn}
                />
                <Metric
                  label="Absent"
                  value={data.summary.total.absent}
                />
                <Metric
                  label="Excluded / Disqualified"
                  value={data.summary.total.disqualified}
                />
                <Metric
                  label="Total Records"
                  value={data.summary.total.records}
                  helper="Eligible plus excluded records"
                />
                <Metric
                  label="Attendance Rate"
                  value={`${data.summary.total.attendanceRate}%`}
                  helper="Checked in / eligible registered"
                />
              </div>
            </section>

            {data.attendeeTypeSummary.length > 0 ? (
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-5">
                  <h3 className="text-xl font-black">
                    Attendance by Registration Type
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Eligible counts exclude records marked Excluded /
                    Disqualified.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.1em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Total Records</th>
                        <th className="px-4 py-3">Eligible</th>
                        <th className="px-4 py-3">Checked In</th>
                        <th className="px-4 py-3">Absent</th>
                        <th className="px-4 py-3">Excluded</th>
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
                          <td className="px-4 py-3">{row.records}</td>
                          <td className="px-4 py-3 font-black text-emerald-700">
                            {row.registered}
                          </td>
                          <td className="px-4 py-3">{row.checkedIn}</td>
                          <td className="px-4 py-3">{row.absent}</td>
                          <td className="px-4 py-3 text-red-700">
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
                    Primary attendee records grouped by {groupLabel}. Eligible
                    excludes disqualified/test registrations.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.1em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3">{groupLabel}</th>
                        <th className="px-4 py-3">Total Records</th>
                        <th className="px-4 py-3">Eligible</th>
                        <th className="px-4 py-3">Checked In</th>
                        <th className="px-4 py-3">Absent</th>
                        <th className="px-4 py-3">Excluded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.batchSummary.map((row) => (
                        <tr
                          key={row.groupValue || "unknown"}
                          className="border-t border-slate-100"
                        >
                          <td className="px-4 py-3 font-bold">
                            {groupDisplayLabel(row.groupValue)}
                          </td>
                          <td className="px-4 py-3">{row.records}</td>
                          <td className="px-4 py-3 font-black text-emerald-700">
                            {row.registered}
                          </td>
                          <td className="px-4 py-3">{row.checkedIn}</td>
                          <td className="px-4 py-3">{row.absent}</td>
                          <td className="px-4 py-3 text-red-700">
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
                  Eligible registered attendees who are not checked in.
                  Excluded/disqualified records never appear here.
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
                      "Companion Of",
                      "Primary Category",
                      "Relationship",
                      "Companions",
                      "Mobile",
                      "Registration Source",
                      "Registered At",
                    ],
                    filteredAbsentees.map((row) => [
                      row.attendeeTypeLabel,
                      row.groupValue,
                      row.registrationNumber,
                      row.fullName,
                      row.companionOf?.fullName || "",
                      row.companionOf
                        ? groupDisplayLabel(row.companionOf.groupValue)
                        : "",
                      row.companionOf?.relationship || "",
                      row.companions
                        .map(
                          (companion) =>
                            companion.fullName +
                            (companion.relationship
                              ? ` (${companion.relationship})`
                              : "")
                        )
                        .join(" | "),
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
                    <th className="px-4 py-3">Companion / Primary</th>
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
                        {groupDisplayLabel(row.groupValue)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <CompanionContextCell
                          companionOf={row.companionOf}
                          companions={row.companions}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {row.mobileNumber || "-"}
                      </td>
                    </tr>
                  ))}
                  {filteredAbsentees.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
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
                Open General Registration
              </a>
            </div>
          </div>

          <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
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
      {activeTab === "groups" ? (
        <RegistrationGroupsPanel eventSlug={eventSlug} />
      ) : null}
      {activeTab === "operations" ? <CommandCenterPage /> : null}
      {activeTab === "reports" ? (
        <ReportsPanel eventSlug={eventSlug} />
      ) : null}
      {activeTab === "raffle" ? <RafflePage /> : null}
      {activeTab === "status" ? <LifecyclePage /> : null}
    </div>
  );
}
