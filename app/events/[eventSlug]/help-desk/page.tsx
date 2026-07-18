"use client";

import * as React from "react";
import { useParams } from "next/navigation";

// -----------------------------------------------------------------
// Types (all existing types preserved)
// -----------------------------------------------------------------

type GuestRow = {
  attendeeId: string;
  fullName: string;
  registrationNumber: string;
  attendanceStatus: string;
  relationship: string;
};

type MedicalCheckpoint = {
  checkpointId: string;
  checkpointNo: number;
  checkpointName: string;
  sortOrder: number;
  sequence: number;
  status: "passed" | "missing";
  passageId: string | null;
  passedAt: string | null;
};

type MedicalLookup = {
  totalCheckpoints: number;
  passedCheckpoints: number;
  missingCheckpoints: number;
  progressPercent: number;
  isComplete: boolean;
  latestCheckpoint: MedicalCheckpoint | null;
  nextMissingCheckpoint: MedicalCheckpoint | null;
  lastKnownPassageAt: string | null;
  checkpointTimeline: MedicalCheckpoint[];
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
  medicalLookup: MedicalLookup;
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

// Walk-in registration result
type WalkInRegisteredGuest = {
  attendeeId: string;
  fullName: string;
  registrationNumber: string;
  passUrl: string;
  relationship: string;
};

type WalkInResult = {
  attendeeId: string;
  fullName: string;
  registrationNumber: string;
  eventPassUrl: string;
  guests: WalkInRegisteredGuest[];
  checkedIn: boolean;
  checkedInAt: string | null;
  checkInError: string | null;
};

// -----------------------------------------------------------------
// Helpers (all existing helpers preserved)
// -----------------------------------------------------------------

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

function formatPassageTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
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

// -----------------------------------------------------------------
// Main page component
// -----------------------------------------------------------------

export default function EventHelpDeskPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  // Search state
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

  // Edit modal state
  const [editOpen, setEditOpen] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [editMobile, setEditMobile] = React.useState("");
  const [editNickname, setEditNickname] = React.useState("");
  const [editGroup, setEditGroup] = React.useState("");

  // Disqualify/undo modal state
  const [disqualifyOpen, setDisqualifyOpen] = React.useState(false);
  const [disqualifyReason, setDisqualifyReason] = React.useState("");
  const [undoOpen, setUndoOpen] = React.useState(false);

  // Walk-in registration state (new)
  const [walkInOpen, setWalkInOpen] = React.useState(false);
  const [walkInName, setWalkInName] = React.useState("");
  const [walkInMobile, setWalkInMobile] = React.useState("");
  const [walkInGroup, setWalkInGroup] = React.useState("");
  const [walkInHasCompanion, setWalkInHasCompanion] = React.useState(false);
  const [walkInCompanionName, setWalkInCompanionName] = React.useState("");
  const [walkInCompanionRelationship, setWalkInCompanionRelationship] = React.useState("Companion");
  const [walkInLoading, setWalkInLoading] = React.useState(false);
  const [walkInError, setWalkInError] = React.useState("");
  const [walkInResult, setWalkInResult] = React.useState<WalkInResult | null>(null);

  const selected =
    results.find((row) => row.attendeeId === selectedId) || results[0] || null;

  // Load group values on mount
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
        if (data.values && data.values.length > 0) {
          setWalkInGroup(data.values[0].value);
        }
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

  // Debounced search
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

  // -----------------------------------------------------------------
  // Search helpers
  // -----------------------------------------------------------------

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

  // -----------------------------------------------------------------
  // Edit
  // -----------------------------------------------------------------

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

  // -----------------------------------------------------------------
  // Reissue pass
  // -----------------------------------------------------------------

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

  // -----------------------------------------------------------------
  // Disqualify
  // -----------------------------------------------------------------

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

  // -----------------------------------------------------------------
  // Walk-in registration (new)
  // -----------------------------------------------------------------

  function openWalkIn() {
    setWalkInOpen(true);
    setWalkInResult(null);
    setWalkInError("");
    setWalkInName("");
    setWalkInMobile("");
    setWalkInGroup(groupValues.length > 0 ? groupValues[0].value : "");
    setWalkInHasCompanion(false);
    setWalkInCompanionName("");
    setWalkInCompanionRelationship("Companion");
  }

  function closeWalkIn() {
    setWalkInOpen(false);
    setWalkInResult(null);
    setWalkInError("");
  }

  async function submitWalkIn() {
    const name = walkInName.trim();
    const mobile = cleanPhone(walkInMobile);
    const group = walkInGroup.trim();

    if (!name) { setWalkInError("Full name is required."); return; }
    if (!mobile || mobile.length < 10) {
      setWalkInError("A valid Philippine mobile number is required (at least 10 digits).");
      return;
    }
    if (!group) { setWalkInError(`${groupLabel} is required.`); return; }

    if (walkInHasCompanion && !walkInCompanionName.trim()) {
      setWalkInError("Companion name is required when companion is selected.");
      return;
    }

    setWalkInLoading(true);
    setWalkInError("");

    try {
      const guests = walkInHasCompanion
        ? [{ fullName: walkInCompanionName.trim(), relationship: walkInCompanionRelationship.trim() || "Companion" }]
        : [];

      const res = await fetch(
        `/api/events/${eventSlug}/help-desk/register`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: name,
            mobileNumber: mobile,
            groupValue: group,
            guests,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok || !data.success) {
        const msg = data.error?.message || data.error || "Registration failed.";
        throw new Error(msg);
      }

      setWalkInResult({
        attendeeId: data.attendeeId,
        fullName: name,
        registrationNumber: data.registrationNumber,
        eventPassUrl: data.eventPassUrl,
        guests: (data.guests || []).map((g: any) => ({
          attendeeId: g.attendeeId,
          fullName: g.fullName,
          registrationNumber: g.registrationNumber,
          passUrl: g.passUrl,
          relationship: g.relationship,
        })),
        checkedIn: data.checkedIn === true,
        checkedInAt: data.checkedInAt || null,
        checkInError: data.checkInError || null,
      });
    } catch (err) {
      setWalkInError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setWalkInLoading(false);
    }
  }

  function registerAnother() {
    setWalkInResult(null);
    setWalkInError("");
    setWalkInName("");
    setWalkInMobile("");
    setWalkInGroup(groupValues.length > 0 ? groupValues[0].value : "");
    setWalkInHasCompanion(false);
    setWalkInCompanionName("");
    setWalkInCompanionRelationship("Companion");
  }

  // -----------------------------------------------------------------
  // Layout helpers
  // -----------------------------------------------------------------

  const modalPanelClass =
    "fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl rounded-t-3xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl";

  const modalBackdrop = editOpen || disqualifyOpen || undoOpen || walkInOpen;

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      {modalBackdrop ? <div className="fixed inset-0 z-40 bg-black/70" /> : null}

      <section className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            JRide Events
          </p>
          <h1 className="mt-3 text-4xl font-black">Help Desk and Registration</h1>
          <p className="mt-2 text-slate-300">
            Search existing attendees or register walk-ins for this event.
          </p>

          {/* Search row + Register Walk-in button */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
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
            <button
              type="button"
              onClick={openWalkIn}
              className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-slate-950 hover:bg-amber-200"
            >
              + Register Walk-in
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

              {selected.medicalLookup.totalCheckpoints > 0 ? (
                <div className="mt-6 rounded-3xl border border-cyan-200 bg-cyan-50 p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-800">
                        Medical Lookup
                      </p>
                      <h3 className="mt-2 text-3xl font-black text-slate-950">
                        Last known runner position
                      </h3>
                    </div>

                    <span
                      className={`w-fit rounded-full border px-4 py-2 text-xs font-black ${
                        selected.medicalLookup.isComplete
                          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                          : selected.isDisqualified
                          ? "border-red-300 bg-red-100 text-red-800"
                          : "border-cyan-300 bg-white text-cyan-900"
                      }`}
                    >
                      {selected.isDisqualified
                        ? "REVIEW REQUIRED"
                        : selected.medicalLookup.isComplete
                        ? "FINISHED"
                        : `${selected.medicalLookup.missingCheckpoints} MISSING`}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-4">
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                        Progress
                      </p>
                      <p className="mt-2 text-3xl font-black text-slate-950">
                        {selected.medicalLookup.progressPercent}%
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                        Passed
                      </p>
                      <p className="mt-2 text-3xl font-black text-slate-950">
                        {selected.medicalLookup.passedCheckpoints}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                        Missing
                      </p>
                      <p className="mt-2 text-3xl font-black text-slate-950">
                        {selected.medicalLookup.missingCheckpoints}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                        Total
                      </p>
                      <p className="mt-2 text-3xl font-black text-slate-950">
                        {selected.medicalLookup.totalCheckpoints}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 h-4 overflow-hidden rounded-full bg-cyan-100">
                    <div
                      className="h-full rounded-full bg-cyan-600"
                      style={{
                        width: `${selected.medicalLookup.progressPercent}%`,
                      }}
                    />
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                        Latest Checkpoint
                      </p>
                      {selected.medicalLookup.latestCheckpoint ? (
                        <>
                          <p className="mt-2 text-xl font-black text-slate-950">
                            Checkpoint {selected.medicalLookup.latestCheckpoint.checkpointNo} -{" "}
                            {selected.medicalLookup.latestCheckpoint.checkpointName}
                          </p>
                          <p className="mt-2 text-sm font-bold text-slate-500">
                            {formatPassageTime(
                              selected.medicalLookup.lastKnownPassageAt
                            )}
                          </p>
                        </>
                      ) : (
                        <p className="mt-2 font-bold text-slate-500">
                          No checkpoint passage recorded.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                        Next Missing Checkpoint
                      </p>
                      {selected.medicalLookup.nextMissingCheckpoint ? (
                        <p className="mt-2 text-xl font-black text-slate-950">
                          Checkpoint {selected.medicalLookup.nextMissingCheckpoint.checkpointNo} -{" "}
                          {selected.medicalLookup.nextMissingCheckpoint.checkpointName}
                        </p>
                      ) : (
                        <p className="mt-2 font-bold text-emerald-700">
                          All checkpoints recorded.
                        </p>
                      )}
                    </div>
                  </div>

                  <details className="mt-5 rounded-2xl bg-white p-4">
                    <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.15em] text-slate-700">
                      View Checkpoint Timeline
                    </summary>

                    <div className="mt-4 grid gap-3">
                      {selected.medicalLookup.checkpointTimeline.map(
                        (checkpoint) => (
                          <div
                            key={checkpoint.checkpointId}
                            className={`rounded-2xl border p-4 ${
                              checkpoint.status === "passed"
                                ? "border-emerald-200 bg-emerald-50"
                                : "border-red-200 bg-red-50"
                            }`}
                          >
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                                  Checkpoint {checkpoint.checkpointNo}
                                </p>
                                <p className="mt-1 text-lg font-black text-slate-950">
                                  {checkpoint.checkpointName}
                                </p>
                              </div>

                              <span
                                className={`w-fit rounded-full px-3 py-1 text-xs font-black ${
                                  checkpoint.status === "passed"
                                    ? "bg-emerald-200 text-emerald-900"
                                    : "bg-red-200 text-red-900"
                                }`}
                              >
                                {checkpoint.status === "passed"
                                  ? "PASSED"
                                  : "MISSING"}
                              </span>
                            </div>

                            {checkpoint.passedAt ? (
                              <p className="mt-2 text-sm font-bold text-slate-500">
                                {formatPassageTime(checkpoint.passedAt)}
                              </p>
                            ) : null}
                          </div>
                        )
                      )}
                    </div>
                  </details>
                </div>
              ) : null}

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

      {/* Edit modal -- unchanged */}
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

      {/* Disqualify modal -- unchanged */}
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

      {/* Undo modal -- unchanged */}
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

      {/* Walk-in Registration panel (new) */}
      {walkInOpen ? (
        <div className={`${modalPanelClass} max-h-[90vh] overflow-y-auto`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
                Walk-in Registration
              </p>
              <h2 className="mt-2 text-3xl font-black">
                {walkInResult ? "Registered" : "New Attendee"}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeWalkIn}
              className="rounded-full border border-slate-600 px-3 py-2 text-sm font-black text-slate-400"
            >
              Close
            </button>
          </div>

          {/* Success state */}
          {walkInResult ? (
            <div className="mt-5">
              <div className="rounded-2xl border border-emerald-700 bg-emerald-900/40 p-4">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
                  Registration Complete
                </p>
                <p className="mt-2 text-2xl font-black">{walkInResult.fullName}</p>
                <p className="mt-1 font-mono text-lg font-bold text-amber-300">
                  {walkInResult.registrationNumber}
                </p>

                {walkInResult.checkedIn ? (
                  <div className="mt-4 rounded-2xl border border-emerald-500 bg-emerald-500/15 p-4">
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-300">
                      Checked In
                    </p>
                    <p className="mt-2 text-lg font-black text-white">
                      Proceed to the venue.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-amber-500 bg-amber-500/15 p-4">
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-300">
                      Check-in Required
                    </p>
                    <p className="mt-2 font-bold text-white">
                      Please scan the Event Pass QR at the gate.
                    </p>
                    {walkInResult.checkInError ? (
                      <p className="mt-2 text-sm text-slate-300">
                        {walkInResult.checkInError}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => window.open(walkInResult.eventPassUrl, "_blank")}
                  className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-slate-950"
                >
                  Print Pass
                </button>
                <a
                  href={walkInResult.eventPassUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-slate-600 px-5 py-4 text-center font-black text-white"
                >
                  Open Pass
                </a>
              </div>

              {walkInResult.guests.length > 0 ? (
                <div className="mt-5">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                    Companion Registered
                  </p>
                  {walkInResult.guests.map((g) => (
                    <div key={g.attendeeId} className="mt-3 rounded-2xl border border-slate-700 bg-slate-950 p-4">
                      <p className="font-black">{g.fullName}</p>
                      <p className="mt-1 font-mono text-sm font-bold text-amber-300">
                        {g.registrationNumber}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        Registered as a companion. Not eligible for raffle. Uses the primary attendee for gate entry.
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={registerAnother}
                  className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-slate-950"
                >
                  Register Another
                </button>
                <button
                  type="button"
                  onClick={closeWalkIn}
                  className="rounded-2xl border border-slate-600 px-5 py-4 font-black text-white"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* Form state */
            <div className="mt-5 grid gap-4">
              {walkInError ? (
                <p className="rounded-2xl bg-red-900/40 border border-red-700 px-4 py-3 text-sm font-bold text-red-300">
                  {walkInError}
                </p>
              ) : null}

              <label className="block">
                <span className="text-sm font-bold text-slate-200">Full Name *</span>
                <input
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder="Enter full name"
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
                />
              </label>

              <label className="block">
                <span className="text-sm font-bold text-slate-200">Mobile Number *</span>
                <input
                  value={walkInMobile}
                  onChange={(e) => setWalkInMobile(e.target.value)}
                  placeholder="09XXXXXXXXX"
                  inputMode="numeric"
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
                />
              </label>

              <label className="block">
                <span className="text-sm font-bold text-slate-200">{groupLabel} *</span>
                <select
                  value={walkInGroup}
                  onChange={(e) => setWalkInGroup(e.target.value)}
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

              {/* Companion section */}
              <div className="rounded-2xl border border-slate-700 p-4">
                <p className="text-sm font-bold text-slate-200">Has Companion?</p>
                <div className="mt-3 flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={!walkInHasCompanion}
                      onChange={() => setWalkInHasCompanion(false)}
                      className="accent-amber-300"
                    />
                    <span className="font-semibold">No</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={walkInHasCompanion}
                      onChange={() => setWalkInHasCompanion(true)}
                      className="accent-amber-300"
                    />
                    <span className="font-semibold">Yes</span>
                  </label>
                </div>

                {walkInHasCompanion ? (
                  <div className="mt-4 grid gap-3">
                    <label className="block">
                      <span className="text-sm font-bold text-slate-200">Companion Name *</span>
                      <input
                        value={walkInCompanionName}
                        onChange={(e) => setWalkInCompanionName(e.target.value)}
                        placeholder="Enter companion name"
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-bold text-slate-200">Relationship</span>
                      <select
                        value={walkInCompanionRelationship}
                        onChange={(e) => setWalkInCompanionRelationship(e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
                      >
                        <option value="Spouse">Spouse</option>
                        <option value="Child">Child</option>
                        <option value="Partner">Partner</option>
                        <option value="Relative">Relative</option>
                        <option value="Friend">Friend</option>
                        <option value="Companion">Companion</option>
                      </select>
                    </label>
                    <p className="text-xs text-slate-400">
                      Companion will be registered as a guest. Separate attendance record created. Not eligible for raffle.
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={closeWalkIn}
                  disabled={walkInLoading}
                  className="rounded-2xl border border-slate-600 px-5 py-4 font-black text-white disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitWalkIn}
                  disabled={walkInLoading}
                  className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-slate-950 disabled:opacity-60"
                >
                  {walkInLoading ? "Registering..." : "Register"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}
