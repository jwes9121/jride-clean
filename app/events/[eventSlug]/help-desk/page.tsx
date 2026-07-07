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

type GroupValue = {
  value: string;
  label: string;
  sort_order: number;
};

type GroupValuesResponse = {
  success: boolean;
  eventSlug?: string;
  groupLabel?: string;
  values?: GroupValue[];
  error?: string;
};

type UpdateResponse = {
  success: boolean;
  attendee?: {
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
  };
  error?: string;
};

type ReissueResponse = {
  success: boolean;
  attendeeId?: string;
  registrationNumber?: string;
  eventPassUrl?: string;
  error?: string;
};

type DisqualifyResponse = {
  success: boolean;
  attendeeId?: string;
  registrationNumber?: string;
  fullName?: string;
  isDisqualified?: boolean;
  disqualificationReason?: string | null;
  noChange?: boolean;
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

function cleanPhone(value: string) {
  return value.replace(/[^0-9]/g, "");
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

function mergeAttendee(row: HelpDeskResult, patch: Partial<HelpDeskResult>): HelpDeskResult {
  return {
    ...row,
    ...patch,
    guests: patch.guests || row.guests,
  };
}

export default function EventHelpDeskPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [query, setQuery] = React.useState("");
  const [groupLabel, setGroupLabel] = React.useState("Group");
  const [groupValues, setGroupValues] = React.useState<GroupValue[]>([]);
  const [results, setResults] = React.useState<HelpDeskResult[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [searched, setSearched] = React.useState(false);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [editMobile, setEditMobile] = React.useState("");
  const [editNickname, setEditNickname] = React.useState("");
  const [editGroup, setEditGroup] = React.useState("");

  const [disqualifyOpen, setDisqualifyOpen] = React.useState(false);
  const [disqualifyReason, setDisqualifyReason] = React.useState("");
  const [undoOpen, setUndoOpen] = React.useState(false);

  const selected =
    results.find((row) => row.attendeeId === selectedId) || results[0] || null;

  React.useEffect(() => {
    let active = true;

    async function loadGroupValues() {
      try {
        const res = await fetch(`/api/events/${eventSlug}/group-values`, {
          cache: "no-store",
        });
        const data = (await res.json()) as GroupValuesResponse;

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to load group values.");
        }

        if (!active) return;
        setGroupLabel(data.groupLabel || "Group");
        setGroupValues(data.values || []);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load group values.");
      }
    }

    if (eventSlug) loadGroupValues();

    return () => {
      active = false;
    };
  }, [eventSlug]);

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
      setNotice("");

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
    setNotice("");
    setSearched(false);
  }

  function updateSelected(patch: Partial<HelpDeskResult>) {
    if (!selected) return;

    setResults((prev) =>
      prev.map((row) =>
        row.attendeeId === selected.attendeeId ? mergeAttendee(row, patch) : row
      )
    );
  }

  function openEditModal() {
    if (!selected) return;
    setError("");
    setNotice("");
    setEditName(selected.fullName || "");
    setEditMobile(selected.mobileNumber || "");
    setEditNickname(selected.nickname || "");
    setEditGroup(selected.groupValue || "");
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!selected) return;

    setActionLoading(true);
    setError("");
    setNotice("");

    try {
      const res = await fetch(
        `/api/events/${eventSlug}/attendees/${selected.attendeeId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: editName.trim(),
            mobileNumber: cleanPhone(editMobile),
            nickname: editNickname.trim(),
            groupValue: editGroup,
          }),
        }
      );

      const data = (await res.json()) as UpdateResponse;

      if (!res.ok || !data.success || !data.attendee) {
        throw new Error(data.error || "Update failed.");
      }

      updateSelected({
        fullName: data.attendee.fullName,
        mobileNumber: data.attendee.mobileNumber,
        nickname: data.attendee.nickname,
        groupValue: data.attendee.groupValue,
        registrationNumber: data.attendee.registrationNumber,
        registrationStatus: data.attendee.registrationStatus,
        attendanceStatus: data.attendee.attendanceStatus,
        checkedInAt: data.attendee.checkedInAt,
        isDisqualified: data.attendee.isDisqualified,
        disqualificationReason: data.attendee.disqualificationReason,
      });

      setEditOpen(false);
      setNotice("Registration updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setActionLoading(false);
    }
  }

  async function reissuePass() {
    if (!selected) return;

    setActionLoading(true);
    setError("");
    setNotice("");

    try {
      const res = await fetch(
        `/api/events/${eventSlug}/attendees/${selected.attendeeId}/reissue-pass`,
        { method: "POST" }
      );

      const data = (await res.json()) as ReissueResponse;

      if (!res.ok || !data.success || !data.eventPassUrl) {
        throw new Error(data.error || "Pass reissue failed.");
      }

      updateSelected({
        eventPassUrl: data.eventPassUrl,
        registrationNumber: data.registrationNumber || selected.registrationNumber,
      });

      window.open(data.eventPassUrl, "_blank");
      setNotice("Event Pass opened.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pass reissue failed.");
    } finally {
      setActionLoading(false);
    }
  }

  function openDisqualifyModal() {
    if (!selected) return;
    setError("");
    setNotice("");
    setDisqualifyReason(selected.disqualificationReason || "");
    setDisqualifyOpen(true);
  }

  async function submitDisqualification(disqualified: boolean) {
    if (!selected) return;

    setActionLoading(true);
    setError("");
    setNotice("");

    try {
      const res = await fetch(
        `/api/events/${eventSlug}/attendees/${selected.attendeeId}/disqualify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            disqualified,
            reason: disqualified ? disqualifyReason.trim() : undefined,
          }),
        }
      );

      const data = (await res.json()) as DisqualifyResponse;

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Disqualification update failed.");
      }

      updateSelected({
        isDisqualified: data.isDisqualified ?? disqualified,
        disqualificationReason:
          data.disqualificationReason === undefined
            ? disqualified
              ? disqualifyReason.trim()
              : null
            : data.disqualificationReason,
      });

      setDisqualifyOpen(false);
      setUndoOpen(false);
      setNotice(disqualified ? "Attendee marked for Help Desk review." : "Disqualification cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disqualification update failed.");
    } finally {
      setActionLoading(false);
    }
  }

  const modalPanelClass =
    "fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl rounded-t-3xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl";

  const modalBackdrop = editOpen || disqualifyOpen || undoOpen;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      {modalBackdrop ? <div className="fixed inset-0 z-40 bg-black/70" /> : null}

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

          {notice ? (
            <p className="mt-4 rounded-2xl bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-800">
              {notice}
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
                    onClick={openEditModal}
                    disabled={actionLoading}
                    className="rounded-2xl bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:opacity-60"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={reissuePass}
                    disabled={actionLoading}
                    className="rounded-2xl bg-slate-950 px-4 py-3 font-black text-white disabled:opacity-60"
                  >
                    Reissue Pass
                  </button>
                  <button
                    type="button"
                    onClick={selected.isDisqualified ? () => setUndoOpen(true) : openDisqualifyModal}
                    disabled={actionLoading}
                    className={`rounded-2xl px-4 py-3 font-black disabled:opacity-60 ${
                      selected.isDisqualified
                        ? "bg-emerald-600 text-white"
                        : "bg-red-700 text-white"
                    }`}
                  >
                    {selected.isDisqualified ? "Undo Review" : "Disqualify"}
                  </button>
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-500">
                  Changes apply only to this attendee record.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {editOpen ? (
        <div className={modalPanelClass}>
          <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
            Edit Registration
          </p>
          <h2 className="mt-2 text-3xl font-black">Correct attendee details</h2>

          <div className="mt-5 grid gap-4">
            <label className="block">
              <span className="text-sm font-bold text-slate-200">Full Name</span>
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-200">Mobile Number</span>
              <input
                value={editMobile}
                onChange={(event) => setEditMobile(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
                inputMode="numeric"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-200">Nickname</span>
              <input
                value={editNickname}
                onChange={(event) => setEditNickname(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-200">{groupLabel}</span>
              <select
                value={editGroup}
                onChange={(event) => setEditGroup(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
              >
                <option value="">Select {groupLabel}</option>
                {groupValues.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={actionLoading}
              className="rounded-2xl border border-slate-600 px-5 py-4 font-black text-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEdit}
              disabled={actionLoading}
              className="rounded-2xl bg-amber-400 px-5 py-4 font-black text-slate-950 disabled:opacity-60"
            >
              {actionLoading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      ) : null}

      {disqualifyOpen ? (
        <div className={modalPanelClass}>
          <p className="text-xs font-black uppercase tracking-[0.25em] text-red-300">
            Disqualify
          </p>
          <h2 className="mt-2 text-3xl font-black">Mark for Help Desk review</h2>
          <p className="mt-3 text-slate-300">
            A reason is required and will be shown to event staff.
          </p>

          <textarea
            value={disqualifyReason}
            onChange={(event) => setDisqualifyReason(event.target.value)}
            className="mt-5 min-h-32 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-red-300"
            placeholder="Reason..."
          />

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setDisqualifyOpen(false)}
              disabled={actionLoading}
              className="rounded-2xl border border-slate-600 px-5 py-4 font-black text-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => submitDisqualification(true)}
              disabled={actionLoading || !disqualifyReason.trim()}
              className="rounded-2xl bg-red-700 px-5 py-4 font-black text-white disabled:opacity-60"
            >
              {actionLoading ? "Saving..." : "Disqualify"}
            </button>
          </div>
        </div>
      ) : null}

      {undoOpen ? (
        <div className={modalPanelClass}>
          <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-300">
            Undo Review
          </p>
          <h2 className="mt-2 text-3xl font-black">Clear disqualification?</h2>
          <p className="mt-3 text-slate-300">
            This attendee will be treated as eligible again.
          </p>

          {selected?.disqualificationReason ? (
            <div className="mt-5 rounded-2xl bg-slate-950 p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Current Reason
              </p>
              <p className="mt-2 font-semibold text-slate-200">
                {selected.disqualificationReason}
              </p>
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setUndoOpen(false)}
              disabled={actionLoading}
              className="rounded-2xl border border-slate-600 px-5 py-4 font-black text-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => submitDisqualification(false)}
              disabled={actionLoading}
              className="rounded-2xl bg-emerald-600 px-5 py-4 font-black text-white disabled:opacity-60"
            >
              {actionLoading ? "Saving..." : "Clear Review"}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
