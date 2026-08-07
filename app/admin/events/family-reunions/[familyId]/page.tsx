"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type FamilyPerson = {
  id: string;
  familyId: string | null;
  fullName: string;
  nickname: string | null;
  sex: string | null;
  birthDate: string | null;
  deathDate: string | null;
  isLiving: boolean;
  locationText: string | null;
  locationScope: string | null;
  locationBucket: string | null;
};

type FamilyResponse = {
  success: boolean;
  error?: string;
  family?: {
    id: string;
    name: string;
    description: string | null;
  };
  people?: FamilyPerson[];
};

type RelationshipResult = {
  success: boolean;
  resultCode?: string;
  relationshipClass?: string;
  relationshipAtoB?: string;
  relationshipBtoA?: string;
  fullOrHalf?: string | null;
  nearestCommonAncestors?: {
    ancestorId: string | null;
    fullName: string | null;
    depthA: number;
    depthB: number;
  }[];
};

type FinderResponse = {
  success: boolean;
  error?: string;
  relationship?: RelationshipResult;
};

type EditorResponse = {
  success: boolean;
  error?: string;
};

type ReunionEvent = {
  linkId?: string;
  linkedAt?: string;
  eventId: string;
  slug: string;
  status: string;
};

type ReunionEventsResponse = {
  success: boolean;
  error?: string;
  linkedEvents?: ReunionEvent[];
  eligibleEvents?: ReunionEvent[];
};

type ParticipationAttendee = {
  attendeeId: string;
  fullName: string;
  nickname: string | null;
  mobileNumber: string | null;
  registrationNumber: string | null;
  registrationStatus: string;
  attendanceStatus: string;
  registeredAt: string;
  checkedInAt: string | null;
  isDisqualified: boolean;
};

type ParticipationPerson = {
  familyPersonId: string;
  fullName: string;
  nickname: string | null;
  locationText: string | null;
  locationBucket: string | null;
  linkId: string | null;
  attendee: ParticipationAttendee | null;
};

type ParticipationResponse = {
  success: boolean;
  error?: string;
  people?: ParticipationPerson[];
  availableAttendees?: ParticipationAttendee[];
  totals?: {
    familyPeople: number;
    linkedPeople: number;
    availableAttendees: number;
  };
};

const IFUGAO_TOWNS = [
  "Aguinaldo",
  "Alfonso Lista",
  "Asipulo",
  "Banaue",
  "Hingyon",
  "Hungduan",
  "Kiangan",
  "Lagawe",
  "Lamut",
  "Mayoyao",
  "Tinoc",
];

function personLabel(person: FamilyPerson) {
  const parts = [person.fullName];

  if (person.nickname) {
    parts.push(`"${person.nickname}"`);
  }

  if (person.locationBucket) {
    parts.push(`- ${person.locationBucket}`);
  }

  return parts.join(" ");
}

function emptyPersonForm() {
  return {
    fullName: "",
    nickname: "",
    sex: "unspecified",
    birthDate: "",
    deathDate: "",
    locationText: "",
    locationScope: "",
    locationBucket: "",
    notes: "",
  };
}

export default function FamilyReunionDetailPage() {
  const params = useParams<{ familyId: string }>();
  const familyId = params.familyId;

  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [familyName, setFamilyName] = React.useState("");
  const [familyDescription, setFamilyDescription] = React.useState("");
  const [people, setPeople] = React.useState<FamilyPerson[]>([]);

  const [personAId, setPersonAId] = React.useState("");
  const [personBId, setPersonBId] = React.useState("");
  const [finding, setFinding] = React.useState(false);
  const [findError, setFindError] = React.useState<string | null>(null);
  const [relationship, setRelationship] =
    React.useState<RelationshipResult | null>(null);

  const [personForm, setPersonForm] = React.useState(emptyPersonForm);
  const [addingPerson, setAddingPerson] = React.useState(false);
  const [personError, setPersonError] = React.useState<string | null>(null);
  const [personSuccess, setPersonSuccess] = React.useState<string | null>(null);

  const [relationshipKind, setRelationshipKind] =
    React.useState<"parent_child" | "spouse">("parent_child");
  const [editorPersonAId, setEditorPersonAId] = React.useState("");
  const [editorPersonBId, setEditorPersonBId] = React.useState("");
  const [parentChildType, setParentChildType] = React.useState("biological");
  const [spouseStatus, setSpouseStatus] = React.useState("married");
  const [addingRelationship, setAddingRelationship] = React.useState(false);
  const [relationshipError, setRelationshipError] =
    React.useState<string | null>(null);
  const [relationshipSuccess, setRelationshipSuccess] =
    React.useState<string | null>(null);

  const [linkedEvents, setLinkedEvents] = React.useState<ReunionEvent[]>([]);
  const [eligibleEvents, setEligibleEvents] = React.useState<ReunionEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = React.useState("");
  const [eventsLoading, setEventsLoading] = React.useState(true);
  const [eventsError, setEventsError] = React.useState<string | null>(null);
  const [linkingEvent, setLinkingEvent] = React.useState(false);
  const [linkSuccess, setLinkSuccess] = React.useState<string | null>(null);

  const [expandedEventId, setExpandedEventId] = React.useState<string | null>(null);
  const [participationPeople, setParticipationPeople] =
    React.useState<ParticipationPerson[]>([]);
  const [availableAttendees, setAvailableAttendees] =
    React.useState<ParticipationAttendee[]>([]);
  const [participationLoading, setParticipationLoading] = React.useState(false);
  const [participationError, setParticipationError] =
    React.useState<string | null>(null);
  const [selectedAttendeeByPerson, setSelectedAttendeeByPerson] =
    React.useState<Record<string, string>>({});
  const [linkingPersonId, setLinkingPersonId] = React.useState<string | null>(null);

  const loadParticipation = React.useCallback(
    async (eventId: string) => {
      setParticipationLoading(true);
      setParticipationError(null);

      try {
        const response = await fetch(
          `/api/events/family-reunions/${encodeURIComponent(
            familyId
          )}/reunion-events/${encodeURIComponent(eventId)}/participation`,
          { method: "GET", cache: "no-store" }
        );

        const data = (await response.json()) as ParticipationResponse;

        if (!response.ok || !data.success) {
          setParticipationError(
            data.error || "Failed to load family participation."
          );
          setParticipationPeople([]);
          setAvailableAttendees([]);
          return;
        }

        setParticipationPeople(data.people || []);
        setAvailableAttendees(data.availableAttendees || []);
      } catch (error) {
        setParticipationError(
          error instanceof Error
            ? error.message
            : "Failed to load family participation."
        );
        setParticipationPeople([]);
        setAvailableAttendees([]);
      } finally {
        setParticipationLoading(false);
      }
    },
    [familyId]
  );

  const loadReunionEvents = React.useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(
          familyId
        )}/reunion-events`,
        { method: "GET", cache: "no-store" }
      );

      const data = (await response.json()) as ReunionEventsResponse;

      if (!response.ok || !data.success) {
        setEventsError(data.error || "Failed to load reunion events.");
        setLinkedEvents([]);
        setEligibleEvents([]);
        return;
      }

      setLinkedEvents(data.linkedEvents || []);
      setEligibleEvents(data.eligibleEvents || []);
    } catch (error) {
      setEventsError(
        error instanceof Error ? error.message : "Failed to load reunion events."
      );
      setLinkedEvents([]);
      setEligibleEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [familyId]);

  const loadFamily = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(familyId)}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data = (await response.json()) as FamilyResponse;

      if (!response.ok || !data.success || !data.family) {
        setLoadError(data.error || "Failed to load family reunion.");
        setPeople([]);
        return;
      }

      setFamilyName(data.family.name);
      setFamilyDescription(data.family.description || "");
      setPeople(data.people || []);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to load family reunion."
      );
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, [familyId]);

  React.useEffect(() => {
    void loadFamily();
    void loadReunionEvents();
  }, [loadFamily, loadReunionEvents]);

  async function linkExistingEvent() {
    setEventsError(null);
    setLinkSuccess(null);

    if (!selectedEventId) {
      setEventsError("Choose an event to link.");
      return;
    }

    setLinkingEvent(true);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(
          familyId
        )}/reunion-events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: selectedEventId }),
        }
      );

      const data = (await response.json()) as ReunionEventsResponse;

      if (!response.ok || !data.success) {
        setEventsError(data.error || "Failed to link reunion event.");
        return;
      }

      setLinkSuccess("Event linked to this family project.");
      setSelectedEventId("");
      await loadReunionEvents();
    } catch (error) {
      setEventsError(
        error instanceof Error ? error.message : "Failed to link reunion event."
      );
    } finally {
      setLinkingEvent(false);
    }
  }

  async function linkFamilyMemberToAttendee(
    eventId: string,
    familyPersonId: string
  ) {
    const attendeeId = selectedAttendeeByPerson[familyPersonId] || "";

    setParticipationError(null);

    if (!attendeeId) {
      setParticipationError("Choose an attendee for this family member.");
      return;
    }

    setLinkingPersonId(familyPersonId);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(
          familyId
        )}/reunion-events/${encodeURIComponent(eventId)}/participation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            familyPersonId,
            attendeeId,
          }),
        }
      );

      const data = (await response.json()) as ParticipationResponse;

      if (!response.ok || !data.success) {
        setParticipationError(
          data.error || "Failed to link family member to attendee."
        );
        return;
      }

      setSelectedAttendeeByPerson((current) => ({
        ...current,
        [familyPersonId]: "",
      }));

      await loadParticipation(eventId);
    } catch (error) {
      setParticipationError(
        error instanceof Error
          ? error.message
          : "Failed to link family member to attendee."
      );
    } finally {
      setLinkingPersonId(null);
    }
  }

  async function findRelationship() {
    setFindError(null);
    setRelationship(null);

    if (!personAId || !personBId) {
      setFindError("Choose two people.");
      return;
    }

    if (personAId === personBId) {
      setFindError("Choose two different people.");
      return;
    }

    setFinding(true);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(
          familyId
        )}/relationship-finder`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personAId,
            personBId,
          }),
        }
      );

      const data = (await response.json()) as FinderResponse;

      if (!response.ok || !data.success || !data.relationship) {
        setFindError(data.error || "Relationship Finder failed.");
        return;
      }

      setRelationship(data.relationship);
    } catch (error) {
      setFindError(
        error instanceof Error ? error.message : "Relationship Finder failed."
      );
    } finally {
      setFinding(false);
    }
  }

  async function addPerson() {
    setPersonError(null);
    setPersonSuccess(null);

    if (!personForm.fullName.trim()) {
      setPersonError("Full name is required.");
      return;
    }

    setAddingPerson(true);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(familyId)}/people`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(personForm),
        }
      );

      const data = (await response.json()) as EditorResponse;

      if (!response.ok || !data.success) {
        setPersonError(data.error || "Failed to add family member.");
        return;
      }

      setPersonSuccess(`${personForm.fullName.trim()} was added.`);
      setPersonForm(emptyPersonForm());
      await loadFamily();
    } catch (error) {
      setPersonError(
        error instanceof Error ? error.message : "Failed to add family member."
      );
    } finally {
      setAddingPerson(false);
    }
  }

  async function addRelationship() {
    setRelationshipError(null);
    setRelationshipSuccess(null);

    if (!editorPersonAId || !editorPersonBId) {
      setRelationshipError("Choose two people.");
      return;
    }

    if (editorPersonAId === editorPersonBId) {
      setRelationshipError("Choose two different people.");
      return;
    }

    const personA = people.find((person) => person.id === editorPersonAId);
    const personB = people.find((person) => person.id === editorPersonBId);

    setAddingRelationship(true);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(
          familyId
        )}/relationships`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            relationshipKind === "parent_child"
              ? {
                  relationshipKind,
                  personAId: editorPersonAId,
                  personBId: editorPersonBId,
                  relationshipType: parentChildType,
                }
              : {
                  relationshipKind,
                  personAId: editorPersonAId,
                  personBId: editorPersonBId,
                  status: spouseStatus,
                }
          ),
        }
      );

      const data = (await response.json()) as EditorResponse;

      if (!response.ok || !data.success) {
        setRelationshipError(
          data.error || "Failed to add family relationship."
        );
        return;
      }

      setRelationshipSuccess(
        relationshipKind === "parent_child"
          ? `${personA?.fullName || "Parent"} -> ${
              personB?.fullName || "Child"
            } added.`
          : `${personA?.fullName || "Person A"} and ${
              personB?.fullName || "Person B"
            } linked as spouses.`
      );
    } catch (error) {
      setRelationshipError(
        error instanceof Error
          ? error.message
          : "Failed to add family relationship."
      );
    } finally {
      setAddingRelationship(false);
    }
  }

  function swapFinderPeople() {
    setPersonAId(personBId);
    setPersonBId(personAId);
    setRelationship(null);
    setFindError(null);
  }

  const locationBucketHint = React.useMemo(() => {
    if (personForm.locationScope === "ifugao_municipality") {
      return "Use the Ifugao municipality.";
    }

    if (personForm.locationScope === "philippines_ncr") {
      return "Use NCR.";
    }

    if (personForm.locationScope === "philippines_province") {
      return "Use the province, for example Nueva Vizcaya.";
    }

    if (personForm.locationScope === "overseas_country") {
      return "Use the country, for example Canada.";
    }

    return "Choose a classification first.";
  }, [personForm.locationScope]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/admin/events/family-reunions"
          className="text-sm font-bold text-amber-300"
        >
          Back to Family Reunions
        </Link>

        {loading ? (
          <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
            Loading family reunion...
          </div>
        ) : loadError ? (
          <div className="mt-6 rounded-3xl border border-red-800 bg-red-950/40 p-6 text-sm text-red-200">
            {loadError}
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
                  Family Reunion
                </p>
                <h1 className="mt-2 text-3xl font-black">{familyName}</h1>
                {familyDescription ? (
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                    {familyDescription}
                  </p>
                ) : null}
              </div>

              <Link
                href={`/admin/events/family-reunions/${familyId}/tree`}
                className="rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950"
              >
                Open Family Tree
              </Link>
            </div>

            <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                JRide Events
              </p>
              <h2 className="mt-2 text-2xl font-black">Reunion Events</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Link this permanent family genealogy to an existing JRide
                Event. The linked event keeps its existing lifecycle and status.
              </p>

              {eventsLoading ? (
                <p className="mt-5 text-sm text-slate-400">
                  Loading reunion events...
                </p>
              ) : (
                <>
                  {linkedEvents.length > 0 ? (
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {linkedEvents.map((event) => (
                        <div
                          key={event.eventId}
                          className="rounded-2xl border border-slate-700 bg-slate-950 p-4"
                        >
                          <p className="font-black text-white">{event.slug}</p>
                          <p className="mt-1 text-sm text-slate-400">
                            Status: {event.status}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link
                              href={`/admin/events/${event.slug}/lifecycle`}
                              className="inline-flex rounded-lg border border-amber-300/40 px-3 py-2 text-xs font-black text-amber-300"
                            >
                              Open Event Lifecycle
                            </Link>

                            <button
                              type="button"
                              onClick={() => {
                                if (expandedEventId === event.eventId) {
                                  setExpandedEventId(null);
                                  setParticipationPeople([]);
                                  setAvailableAttendees([]);
                                  setParticipationError(null);
                                } else {
                                  setExpandedEventId(event.eventId);
                                  void loadParticipation(event.eventId);
                                }
                              }}
                              className="rounded-lg border border-cyan-300/40 px-3 py-2 text-xs font-black text-cyan-300"
                            >
                              {expandedEventId === event.eventId
                                ? "Close Participation"
                                : "Family Participation"}
                            </button>
                          </div>

                          {expandedEventId === event.eventId ? (
                            <div className="mt-4 border-t border-slate-800 pt-4">
                              <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-300">
                                Family Participation
                              </p>

                              {participationLoading ? (
                                <p className="mt-3 text-sm text-slate-400">
                                  Loading family participation...
                                </p>
                              ) : participationError ? (
                                <div className="mt-3 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                                  {participationError}
                                </div>
                              ) : participationPeople.length === 0 ? (
                                <p className="mt-3 text-sm text-slate-400">
                                  No family members have been added to this
                                  genealogy project yet.
                                </p>
                              ) : (
                                <div className="mt-3 space-y-3">
                                  {participationPeople.map((person) => (
                                    <div
                                      key={person.familyPersonId}
                                      className="rounded-xl border border-slate-800 bg-slate-900 p-3"
                                    >
                                      <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                          <p className="font-black text-white">
                                            {person.fullName}
                                          </p>
                                          <p className="mt-1 text-xs text-slate-400">
                                            {person.locationBucket ||
                                              person.locationText ||
                                              "Location not recorded"}
                                          </p>
                                        </div>

                                        {person.attendee ? (
                                          <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-300">
                                            Linked
                                          </span>
                                        ) : (
                                          <span className="rounded-full bg-slate-700 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                                            Not Linked
                                          </span>
                                        )}
                                      </div>

                                      {person.attendee ? (
                                        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
                                          <p>
                                            Attendee:{" "}
                                            <span className="font-bold text-white">
                                              {person.attendee.fullName}
                                            </span>
                                          </p>
                                          <p className="mt-1">
                                            Registration:{" "}
                                            {person.attendee.registrationNumber ||
                                              "No registration number"}
                                          </p>
                                          <p className="mt-1">
                                            Attendance:{" "}
                                            {person.attendee.attendanceStatus}
                                          </p>
                                          {person.attendee.checkedInAt ? (
                                            <p className="mt-1">
                                              Checked in:{" "}
                                              {person.attendee.checkedInAt}
                                            </p>
                                          ) : null}
                                        </div>
                                      ) : availableAttendees.length > 0 ? (
                                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                          <select
                                            value={
                                              selectedAttendeeByPerson[
                                                person.familyPersonId
                                              ] || ""
                                            }
                                            onChange={(changeEvent) =>
                                              setSelectedAttendeeByPerson(
                                                (current) => ({
                                                  ...current,
                                                  [person.familyPersonId]:
                                                    changeEvent.target.value,
                                                })
                                              )
                                            }
                                            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                                          >
                                            <option value="">
                                              Choose event attendee
                                            </option>
                                            {availableAttendees.map(
                                              (attendee) => (
                                                <option
                                                  key={attendee.attendeeId}
                                                  value={attendee.attendeeId}
                                                >
                                                  {attendee.fullName}
                                                  {attendee.registrationNumber
                                                    ? ` - ${attendee.registrationNumber}`
                                                    : ""}
                                                </option>
                                              )
                                            )}
                                          </select>

                                          <button
                                            type="button"
                                            onClick={() =>
                                              void linkFamilyMemberToAttendee(
                                                event.eventId,
                                                person.familyPersonId
                                              )
                                            }
                                            disabled={
                                              linkingPersonId ===
                                                person.familyPersonId ||
                                              !selectedAttendeeByPerson[
                                                person.familyPersonId
                                              ]
                                            }
                                            className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
                                          >
                                            {linkingPersonId ===
                                            person.familyPersonId
                                              ? "Linking..."
                                              : "Match Attendee"}
                                          </button>
                                        </div>
                                      ) : (
                                        <p className="mt-3 text-xs text-slate-500">
                                          No unmatched attendees are available
                                          for this event.
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-400">
                      No reunion events are linked to this family yet.
                    </div>
                  )}

                  <div className="mt-5 border-t border-slate-800 pt-5">
                    <p className="text-sm font-black text-white">
                      Link Existing Event
                    </p>

                    {eligibleEvents.length > 0 ? (
                      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                        <select
                          value={selectedEventId}
                          onChange={(event) =>
                            setSelectedEventId(event.target.value)
                          }
                          className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                        >
                          <option value="">Choose unlinked event</option>
                          {eligibleEvents.map((event) => (
                            <option key={event.eventId} value={event.eventId}>
                              {event.slug} - {event.status}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => void linkExistingEvent()}
                          disabled={linkingEvent || !selectedEventId}
                          className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
                        >
                          {linkingEvent ? "Linking..." : "Link Event"}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-slate-400">
                        No unlinked JRide Events are currently available.
                      </p>
                    )}
                  </div>

                  {eventsError ? (
                    <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                      {eventsError}
                    </div>
                  ) : null}

                  {linkSuccess ? (
                    <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
                      {linkSuccess}
                    </div>
                  ) : null}
                </>
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-xl font-black">Family Members</h2>
              <p className="mt-1 text-sm text-slate-400">
                {people.length} people currently assigned to this genealogy
                project.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {people.map((person) => (
                  <div
                    key={person.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
                  >
                    <p className="font-black text-white">{person.fullName}</p>
                    {person.nickname ? (
                      <p className="mt-1 text-sm text-slate-400">
                        "{person.nickname}"
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm text-slate-400">
                      {person.locationText || "Location not recorded"}
                    </p>
                    {person.locationBucket ? (
                      <span className="mt-2 inline-flex rounded-full bg-amber-300/10 px-2.5 py-1 text-xs font-bold text-amber-300">
                        {person.locationBucket}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                  Genealogy Editor
                </p>
                <h2 className="mt-2 text-2xl font-black">Add Family Member</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Add the person first. Parent, child, and spouse relationships
                  are added separately so the graph remains explicit.
                </p>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="text-xs font-bold text-slate-300">
                      Full Name *
                    </span>
                    <input
                      value={personForm.fullName}
                      onChange={(event) =>
                        setPersonForm((current) => ({
                          ...current,
                          fullName: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-bold text-slate-300">
                      Nickname
                    </span>
                    <input
                      value={personForm.nickname}
                      onChange={(event) =>
                        setPersonForm((current) => ({
                          ...current,
                          nickname: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-bold text-slate-300">
                      Sex
                    </span>
                    <select
                      value={personForm.sex}
                      onChange={(event) =>
                        setPersonForm((current) => ({
                          ...current,
                          sex: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    >
                      <option value="unspecified">Unspecified</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </label>

                  <label>
                    <span className="text-xs font-bold text-slate-300">
                      Birth Date
                    </span>
                    <input
                      type="date"
                      value={personForm.birthDate}
                      onChange={(event) =>
                        setPersonForm((current) => ({
                          ...current,
                          birthDate: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-bold text-slate-300">
                      Death Date
                    </span>
                    <input
                      type="date"
                      value={personForm.deathDate}
                      onChange={(event) =>
                        setPersonForm((current) => ({
                          ...current,
                          deathDate: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    />
                  </label>

                  <label className="sm:col-span-2">
                    <span className="text-xs font-bold text-slate-300">
                      Detailed Place
                    </span>
                    <input
                      value={personForm.locationText}
                      onChange={(event) =>
                        setPersonForm((current) => ({
                          ...current,
                          locationText: event.target.value,
                        }))
                      }
                      placeholder="Example: Quezon City or Bayombong"
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-bold text-slate-300">
                      Reporting Classification
                    </span>
                    <select
                      value={personForm.locationScope}
                      onChange={(event) => {
                        const nextScope = event.target.value;
                        setPersonForm((current) => ({
                          ...current,
                          locationScope: nextScope,
                          locationBucket:
                            nextScope === "philippines_ncr"
                              ? "NCR"
                              : "",
                        }));
                      }}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    >
                      <option value="">Not classified yet</option>
                      <option value="ifugao_municipality">
                        Ifugao Municipality
                      </option>
                      <option value="philippines_province">
                        Philippine Province
                      </option>
                      <option value="philippines_ncr">NCR</option>
                      <option value="overseas_country">
                        Overseas Country
                      </option>
                    </select>
                  </label>

                  <label>
                    <span className="text-xs font-bold text-slate-300">
                      Reporting Bucket
                    </span>
                    {personForm.locationScope === "ifugao_municipality" ? (
                      <select
                        value={personForm.locationBucket}
                        onChange={(event) =>
                          setPersonForm((current) => ({
                            ...current,
                            locationBucket: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                      >
                        <option value="">Choose town</option>
                        {IFUGAO_TOWNS.map((town) => (
                          <option key={town} value={town}>
                            {town}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={personForm.locationBucket}
                        disabled={
                          !personForm.locationScope ||
                          personForm.locationScope === "philippines_ncr"
                        }
                        onChange={(event) =>
                          setPersonForm((current) => ({
                            ...current,
                            locationBucket: event.target.value,
                          }))
                        }
                        placeholder={
                          personForm.locationScope === "philippines_province"
                            ? "Province"
                            : personForm.locationScope === "overseas_country"
                            ? "Country"
                            : ""
                        }
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm disabled:opacity-60"
                      />
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {locationBucketHint}
                    </p>
                  </label>

                  <label className="sm:col-span-2">
                    <span className="text-xs font-bold text-slate-300">
                      Notes
                    </span>
                    <textarea
                      value={personForm.notes}
                      onChange={(event) =>
                        setPersonForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    />
                  </label>
                </div>

                {personError ? (
                  <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                    {personError}
                  </div>
                ) : null}

                {personSuccess ? (
                  <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
                    {personSuccess}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void addPerson()}
                  disabled={addingPerson}
                  className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:opacity-50"
                >
                  {addingPerson ? "Adding..." : "Add Family Member"}
                </button>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                  Genealogy Editor
                </p>
                <h2 className="mt-2 text-2xl font-black">
                  Add Relationship
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Parent-child direction matters: Person A is the parent and
                  Person B is the child. Spouse relationships are symmetric.
                </p>

                <div className="mt-5 grid grid-cols-2 rounded-xl border border-slate-700 bg-slate-950 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setRelationshipKind("parent_child");
                      setRelationshipError(null);
                      setRelationshipSuccess(null);
                    }}
                    className={`rounded-lg px-3 py-2 text-sm font-black ${
                      relationshipKind === "parent_child"
                        ? "bg-amber-400 text-slate-950"
                        : "text-slate-300"
                    }`}
                  >
                    Parent / Child
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRelationshipKind("spouse");
                      setRelationshipError(null);
                      setRelationshipSuccess(null);
                    }}
                    className={`rounded-lg px-3 py-2 text-sm font-black ${
                      relationshipKind === "spouse"
                        ? "bg-amber-400 text-slate-950"
                        : "text-slate-300"
                    }`}
                  >
                    Spouse
                  </button>
                </div>

                <div className="mt-5 space-y-4">
                  <label className="block">
                    <span className="text-xs font-bold text-slate-300">
                      {relationshipKind === "parent_child"
                        ? "Person A - Parent"
                        : "Person A"}
                    </span>
                    <select
                      value={editorPersonAId}
                      onChange={(event) =>
                        setEditorPersonAId(event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    >
                      <option value="">Choose person</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {personLabel(person)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold text-slate-300">
                      {relationshipKind === "parent_child"
                        ? "Person B - Child"
                        : "Person B"}
                    </span>
                    <select
                      value={editorPersonBId}
                      onChange={(event) =>
                        setEditorPersonBId(event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                    >
                      <option value="">Choose person</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {personLabel(person)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {relationshipKind === "parent_child" ? (
                    <label className="block">
                      <span className="text-xs font-bold text-slate-300">
                        Relationship Type
                      </span>
                      <select
                        value={parentChildType}
                        onChange={(event) =>
                          setParentChildType(event.target.value)
                        }
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                      >
                        <option value="biological">Biological</option>
                        <option value="adoptive">Adoptive</option>
                        <option value="step">Step</option>
                      </select>
                    </label>
                  ) : (
                    <label className="block">
                      <span className="text-xs font-bold text-slate-300">
                        Status
                      </span>
                      <select
                        value={spouseStatus}
                        onChange={(event) =>
                          setSpouseStatus(event.target.value)
                        }
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm"
                      >
                        <option value="married">Married</option>
                        <option value="partner">Partner</option>
                        <option value="separated">Separated</option>
                        <option value="divorced">Divorced</option>
                        <option value="widowed">Widowed</option>
                      </select>
                    </label>
                  )}
                </div>

                {relationshipError ? (
                  <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                    {relationshipError}
                  </div>
                ) : null}

                {relationshipSuccess ? (
                  <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
                    {relationshipSuccess}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void addRelationship()}
                  disabled={addingRelationship}
                  className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950 disabled:opacity-50"
                >
                  {addingRelationship
                    ? "Adding..."
                    : relationshipKind === "parent_child"
                    ? "Add Parent / Child Relationship"
                    : "Add Spouse Relationship"}
                </button>
              </div>
            </section>

            <section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                Relationship Finder
              </p>
              <h2 className="mt-2 text-2xl font-black">
                How are two family members related?
              </h2>

              {people.length < 2 ? (
                <p className="mt-4 text-sm text-slate-400">
                  At least two people are required before Relationship Finder
                  can be used.
                </p>
              ) : (
                <>
                  <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                        Person A
                      </span>
                      <select
                        value={personAId}
                        onChange={(event) => {
                          setPersonAId(event.target.value);
                          setRelationship(null);
                          setFindError(null);
                        }}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                      >
                        <option value="">Choose a family member</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {personLabel(person)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      onClick={swapFinderPeople}
                      disabled={!personAId && !personBId}
                      className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold text-slate-300 disabled:opacity-40"
                    >
                      Swap
                    </button>

                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                        Person B
                      </span>
                      <select
                        value={personBId}
                        onChange={(event) => {
                          setPersonBId(event.target.value);
                          setRelationship(null);
                          setFindError(null);
                        }}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                      >
                        <option value="">Choose a family member</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {personLabel(person)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => void findRelationship()}
                    disabled={finding || !personAId || !personBId}
                    className="mt-5 w-full rounded-2xl bg-amber-400 px-5 py-4 font-black text-slate-950 disabled:opacity-50"
                  >
                    {finding
                      ? "Finding relationship..."
                      : "Find Relationship"}
                  </button>
                </>
              )}

              {findError ? (
                <div className="mt-5 rounded-2xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
                  {findError}
                </div>
              ) : null}
            </section>

            {relationship && personAId && personBId ? (
              <section className="mt-6 rounded-3xl border border-amber-300/30 bg-slate-900 p-6">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                  Relationship Result
                </p>

                {relationship.resultCode === "FOUND" ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                        Person A to Person B
                      </p>
                      <p className="mt-2 text-lg font-black">
                        {relationship.relationshipAtoB}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                        Person B to Person A
                      </p>
                      <p className="mt-2 text-lg font-black">
                        {relationship.relationshipBtoA}
                      </p>
                    </div>
                  </div>
                ) : relationship.resultCode === "UNRELATED" ? (
                  <h2 className="mt-3 text-2xl font-black">
                    No biological relationship was found in the recorded tree.
                  </h2>
                ) : (
                  <h2 className="mt-3 text-2xl font-black">
                    Complex shared ancestry detected.
                  </h2>
                )}

                {(relationship.nearestCommonAncestors || []).length > 0 ? (
                  <div className="mt-6">
                    <h3 className="font-black">
                      Nearest Common Ancestor
                      {(relationship.nearestCommonAncestors || []).length > 1
                        ? "s"
                        : ""}
                    </h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(relationship.nearestCommonAncestors || []).map(
                        (ancestor, index) => (
                          <div
                            key={ancestor.ancestorId || String(index)}
                            className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
                          >
                            <p className="font-bold">
                              {ancestor.fullName || "Recorded ancestor"}
                            </p>
                            <p className="mt-1 text-sm text-slate-400">
                              Depth A: {ancestor.depthA}
                            </p>
                            <p className="text-sm text-slate-400">
                              Depth B: {ancestor.depthB}
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
