"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type GuestRow = {
  attendeeId: string;
  fullName: string;
  registrationNumber: string;
  attendanceStatus: string;
  relationship: string;
};

type HelpDeskResult = {
  attendeeId: string;
  fullName: string;
  mobileNumber: string | null;
  nickname: string | null;
  groupValue: string | null;
  registrationNumber: string;
  registrationStatus: string | null;
  attendanceStatus: string | null;
  checkedInAt: string | null;
  isDisqualified: boolean | null;
  disqualificationReason: string | null;
  eventPassUrl: string;
  guests: GuestRow[];
};

type SearchResponse = {
  success: boolean;
  eventSlug?: string;
  groupLabel?: string;
  count?: number;
  results?: HelpDeskResult[];
  error?: string;
};

function formatCheckedIn(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function phoneHref(value: string | null) {
  const cleaned = String(value || "").replace(/[^0-9+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

function statusLabel(value: string | null | undefined) {
  return String(value || "unknown").replace(/_/g, " ");
}

function badgeClass(row: HelpDeskResult) {
  if (row.isDisqualified) return "border-red-300 bg-red-100 text-red-800";
  if (row.attendanceStatus === "checked_in") {
    return "border-emerald-300 bg-emerald-100 text-emerald-800";
  }
  return "border-amber-300 bg-amber-100 text-amber-900";
}

function badgeText(row: HelpDeskResult) {
  if (row.isDisqualified) return "Needs Help Desk";
  if (row.attendanceStatus === "checked_in") return "Checked In";
  return "Registered";
}

export default function EventHelpDeskPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [query, setQuery] = React.useState("");
  const [groupLabel, setGroupLabel] = React.useState("Group");
  const [results, setResults] = React.useState<HelpDeskResult[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [searched, setSearched] = React.useState(false);

  const selected =
    results.find((row) => row.attendeeId === selectedId) || results[0] || null;

  React.useEffect(() => {
    const term = query.trim();

    if (term.length < 2) {
      setResults([]);
      setSelectedId("");
      setError("");
      setSearched(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");

      try {
        const res = await fetch(
          `/api/events/${eventSlug}/help-desk/search?q=${encodeURIComponent(term)}`,
          { cache: "no-store" }
        );

        const data = (await res.json()) as SearchResponse;

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Search failed.");
        }

        if (!active) return;

        const nextResults = data.results || [];
        setGroupLabel(data.groupLabel || "Group");
        setResults(nextResults);
        setSelectedId(nextResults.length === 1 ? nextResults[0].attendeeId : "");
        setSearched(true);
      } catch (err) {
        if (!active) return;
        setResults([]);
        setSelectedId("");
        setError(err instanceof Error ? err.message : "Search failed.");
        setSearched(true);
      } finally {
        if (active) setLoading(false);
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [eventSlug, query]);

  function clearSearch() {
    setQuery("");
    setResults([]);
    setSelectedId("");
    setError("");
    setSearched(false);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <section className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            JRide Events
          </p>
          <h1 className="mt-3 text-4xl font-black">Volunteer Console</h1>
          <p className="mt-2 text-slate-300">
            Search by registration number, name, nickname, or mobile number.
          </p>

          <div className="mt-6 flex gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-lg font-semibold text-white outline-none focus:border-amber-300"
              placeholder="Search attendee..."
              autoComplete="off"
            />
            <button
              type="button"
              onClick={clearSearch}
              className="rounded-2xl border border-slate-600 px-5 py-4 font-black text-white"
            >
              Clear
            </button>
          </div>

          {loading ? (
            <p className="mt-4 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-300">
              Searching...
            </p>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-2xl bg-red-100 px-4 py-3 text-sm font-bold text-red-800">
              {error}
            </p>
          ) : null}

          {!loading && searched && results.length === 0 && !error ? (
            <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-950 p-6">
              <h2 className="text-2xl font-black">No result found</h2>
              <p className="mt-2 text-slate-400">
                Try registration number, full name, nickname, or mobile number.
              </p>
            </div>
          ) : null}

          {results.length > 1 ? (
            <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Multiple matches
              </p>
              <div className="mt-3 grid gap-3">
                {results.map((row) => (
                  <button
                    key={row.attendeeId}
                    type="button"
                    onClick={() => setSelectedId(row.attendeeId)}
                    className={`rounded-2xl border p-4 text-left ${
                      selected?.attendeeId === row.attendeeId
                        ? "border-amber-300 bg-amber-300 text-slate-950"
                        : "border-slate-700 bg-slate-900 text-white"
                    }`}
                  >
                    <p className="text-xl font-black">{row.fullName}</p>
                    <p className="mt-1 font-mono text-sm font-bold">
                      {row.registrationNumber}
                    </p>
                    <p className="mt-1 text-sm">
                      {groupLabel} {row.groupValue || "-"} | {statusLabel(row.attendanceStatus)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!selected && !loading && !searched ? (
            <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-950 p-6">
              <h2 className="text-2xl font-black">Ready for Help Desk</h2>
              <p className="mt-2 text-slate-400">
                Ask for name, registration number, or mobile number. Results will appear here.
              </p>
            </div>
          ) : null}

          {selected ? (
            <div className="mt-5 rounded-3xl bg-white p-6 text-slate-950">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">
                    Attendee
                  </p>
                  <h2 className="mt-2 text-4xl font-black leading-tight">
                    {selected.fullName}
                  </h2>
                  {selected.nickname ? (
                    <p className="mt-1 text-lg font-bold text-slate-500">
                      {selected.nickname}
                    </p>
                  ) : null}
                </div>

                <div className={`w-fit rounded-full border px-4 py-2 text-sm font-black ${badgeClass(selected)}`}>
                  {badgeText(selected)}
                </div>
              </div>

              {selected.isDisqualified ? (
                <div className="mt-5 rounded-2xl bg-red-100 p-4 text-red-800">
                  <p className="text-sm font-black uppercase tracking-[0.2em]">
                    Review Required
                  </p>
                  <p className="mt-2 font-semibold">
                    {selected.disqualificationReason || "Please review this attendee."}
                  </p>
                </div>
              ) : null}

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Registration No.
                  </p>
                  <p className="mt-2 font-mono text-2xl font-black">
                    {selected.registrationNumber}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    {groupLabel}
                  </p>
                  <p className="mt-2 text-2xl font-black">
                    {selected.groupValue || "-"}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Mobile
                  </p>
                  {phoneHref(selected.mobileNumber) ? (
                    <a
                      href={phoneHref(selected.mobileNumber)}
                      className="mt-2 inline-flex text-2xl font-black text-red-800"
                    >
                      {selected.mobileNumber}
                    </a>
                  ) : (
                    <p className="mt-2 text-2xl font-black">-</p>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Registration Status
                  </p>
                  <p className="mt-2 text-xl font-black">
                    {statusLabel(selected.registrationStatus)}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Attendance Status
                  </p>
                  <p className="mt-2 text-xl font-black">
                    {statusLabel(selected.attendanceStatus)}
                  </p>
                  {selected.checkedInAt ? (
                    <p className="mt-2 text-sm font-bold text-slate-500">
                      Checked in: {formatCheckedIn(selected.checkedInAt)}
                    </p>
                  ) : null}
                </div>
              </div>

              {selected.guests.length > 0 ? (
                <div className="mt-6 rounded-2xl bg-slate-100 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Guests
                  </p>
                  <div className="mt-3 grid gap-3">
                    {selected.guests.map((guest) => (
                      <div key={guest.attendeeId} className="rounded-2xl bg-white p-4">
                        <p className="text-lg font-black">{guest.fullName}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-500">
                          {guest.relationship} | {guest.registrationNumber} | {statusLabel(guest.attendanceStatus)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <a
                  href={selected.eventPassUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl bg-slate-950 px-5 py-4 text-center font-black text-white"
                >
                  View Event Pass
                </a>
                <button
                  type="button"
                  onClick={() => window.open(selected.eventPassUrl, "_blank")}
                  className="rounded-2xl border border-slate-300 px-5 py-4 font-black text-slate-950"
                >
                  Print Pass
                </button>
              </div>

              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-4">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  Actions
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    disabled
                    className="rounded-2xl bg-slate-200 px-4 py-3 font-black text-slate-500"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-2xl bg-slate-200 px-4 py-3 font-black text-slate-500"
                  >
                    Reissue Pass
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-2xl bg-slate-200 px-4 py-3 font-black text-slate-500"
                  >
                    Disqualify
                  </button>
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-500">
                  Edit, reissue, and disqualification actions will be added in EVT-007D.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
