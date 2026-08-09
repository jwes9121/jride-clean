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
    displayRootPersonId: string | null;
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

type QuickAddCandidate = {
  candidateId: string;
  fullName: string;
  nickname: string | null;
  locationText: string | null;
  locationBucket: string | null;
  matchScope: "CURRENT_FAMILY" | "OTHER_FAMILY";
  organizationalFamily: {
    id: string;
    name: string | null;
  } | null;
  similarityScore: number;
  biologicalParentCount: number;
  biologicalParents: {
    id: string;
    fullName: string;
  }[];
  proposedParentAlreadyLinked: boolean;
  cycleWouldBeCreated: boolean;
  quickAddDecision:
    | "NO_PARENT_PROPOSED"
    | "SAFE_TO_LINK"
    | "ALREADY_LINKED"
    | "ADVANCED_EDITOR_REQUIRED"
    | "CYCLE_WOULD_BE_CREATED";
};

type QuickAddCandidatesResponse = {
  success: boolean;
  error?: string;
  currentFamilyMatches?: QuickAddCandidate[];
  otherFamilyMatches?: QuickAddCandidate[];
};

type TreeGenerationResponse = {
  success: boolean;
  error?: string;
  generations?: {
    generation: number;
    people: {
      id: string;
      fullName: string;
    }[];
  }[];
};

type QuickEntryWriteResponse = {
  success: boolean;
  resultCode?: string;
  error?: string;
  message?: string;
  personId?: string | null;
  relationshipId?: string | null;
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
  const [displayRootPersonId, setDisplayRootPersonId] =
    React.useState<string | null>(null);
  const [selectedRootPersonId, setSelectedRootPersonId] = React.useState("");
  const [savingRoot, setSavingRoot] = React.useState(false);
  const [rootError, setRootError] = React.useState<string | null>(null);
  const [rootSuccess, setRootSuccess] = React.useState<string | null>(null);

  const [quickRelationship, setQuickRelationship] =
    React.useState<"child" | "spouse">("child");
  const [quickAnchorPersonId, setQuickAnchorPersonId] = React.useState("");
  const [quickName, setQuickName] = React.useState("");
  const [quickSearching, setQuickSearching] = React.useState(false);
  const [quickSearchError, setQuickSearchError] = React.useState<string | null>(null);
  const [quickCurrentMatches, setQuickCurrentMatches] =
    React.useState<QuickAddCandidate[]>([]);
  const [quickOtherMatches, setQuickOtherMatches] =
    React.useState<QuickAddCandidate[]>([]);
  const [generationByPersonId, setGenerationByPersonId] =
    React.useState<Record<string, number>>({});
  const [generationLoading, setGenerationLoading] = React.useState(false);
  const [generationRefreshKey, setGenerationRefreshKey] = React.useState(0);

  const [quickSex, setQuickSex] = React.useState("unspecified");
  const [quickLocationText, setQuickLocationText] = React.useState("");
  const [quickLocationScope, setQuickLocationScope] = React.useState("");
  const [quickLocationBucket, setQuickLocationBucket] = React.useState("");
  const [quickWriting, setQuickWriting] = React.useState(false);
  const [quickWriteError, setQuickWriteError] = React.useState<string | null>(null);
  const [quickWriteSuccess, setQuickWriteSuccess] =
    React.useState<string | null>(null);
  const [quickCreateOverride, setQuickCreateOverride] = React.useState(false);
  const [chartActivePersonId, setChartActivePersonId] = React.useState("");
  const [chartEntryOpen, setChartEntryOpen] = React.useState(false);

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
      setDisplayRootPersonId(data.family.displayRootPersonId || null);
      setSelectedRootPersonId(data.family.displayRootPersonId || "");
      setPeople(data.people || []);
      const loadedDisplayRootPersonId =
        data.family.displayRootPersonId || "";

      setQuickAnchorPersonId((current) => {
        if (current) return current;

        return loadedDisplayRootPersonId || data.people?.[0]?.id || "";
      });

      setChartActivePersonId((current) => {
        if (current) return current;

        return loadedDisplayRootPersonId || data.people?.[0]?.id || "";
      });
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

  React.useEffect(() => {
    let cancelled = false;

    async function loadGenerationMap() {
      if (!displayRootPersonId) {
        setGenerationByPersonId({});
        return;
      }

      setGenerationLoading(true);

      try {
        const response = await fetch(
          `/api/events/family-reunions/${encodeURIComponent(
            familyId
          )}/tree?rootPersonId=${encodeURIComponent(
            displayRootPersonId
          )}&generations=5`,
          { method: "GET", cache: "no-store" }
        );

        const data = (await response.json()) as TreeGenerationResponse;

        if (cancelled) return;

        if (!response.ok || !data.success) {
          setGenerationByPersonId({});
          return;
        }

        const next: Record<string, number> = {};

        for (const generation of data.generations || []) {
          for (const person of generation.people || []) {
            next[person.id] = generation.generation;
          }
        }

        setGenerationByPersonId(next);
      } catch {
        if (!cancelled) {
          setGenerationByPersonId({});
        }
      } finally {
        if (!cancelled) {
          setGenerationLoading(false);
        }
      }
    }

    void loadGenerationMap();

    return () => {
      cancelled = true;
    };
  }, [displayRootPersonId, familyId, generationRefreshKey]);

  React.useEffect(() => {
    let cancelled = false;

    const query = quickName.trim();

    if (query.length < 2) {
      setQuickSearching(false);
      setQuickSearchError(null);
      setQuickCurrentMatches([]);
      setQuickOtherMatches([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setQuickSearching(true);
      setQuickSearchError(null);

      try {
        const params = new URLSearchParams({ q: query });

        if (quickRelationship === "child" && quickAnchorPersonId) {
          params.set("proposedParentId", quickAnchorPersonId);
        }

        const response = await fetch(
          `/api/events/family-reunions/${encodeURIComponent(
            familyId
          )}/quick-add/candidates?${params.toString()}`,
          { method: "GET", cache: "no-store" }
        );

        const data = (await response.json()) as QuickAddCandidatesResponse;

        if (cancelled) return;

        if (!response.ok || !data.success) {
          setQuickSearchError(
            data.error || "Failed to search existing family records."
          );
          setQuickCurrentMatches([]);
          setQuickOtherMatches([]);
          return;
        }

        setQuickCurrentMatches(data.currentFamilyMatches || []);
        setQuickOtherMatches(data.otherFamilyMatches || []);
      } catch (error) {
        if (cancelled) return;

        setQuickSearchError(
          error instanceof Error
            ? error.message
            : "Failed to search existing family records."
        );
        setQuickCurrentMatches([]);
        setQuickOtherMatches([]);
      } finally {
        if (!cancelled) {
          setQuickSearching(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [familyId, quickAnchorPersonId, quickName, quickRelationship]);

  function resetQuickNewPersonFields() {
    setQuickName("");
    setQuickSex("unspecified");
    setQuickLocationText("");
    setQuickLocationScope("");
    setQuickLocationBucket("");
    setQuickCurrentMatches([]);
    setQuickOtherMatches([]);
    setQuickCreateOverride(false);
  }

  async function runQuickEntry(
    mode: "create_new" | "use_existing",
    existingPersonId?: string
  ) {
    setQuickWriteError(null);
    setQuickWriteSuccess(null);

    if (!quickAnchorPersonId) {
      setQuickWriteError("Choose the family member to add to.");
      return;
    }

    if (mode === "create_new" && !quickName.trim()) {
      setQuickWriteError("Enter the new person's name.");
      return;
    }

    if (mode === "create_new" && quickHasExactNameMatch) {
      setQuickWriteError(
        "An exact-name person already exists. Use the existing record instead."
      );
      return;
    }

    setQuickWriting(true);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(
          familyId
        )}/quick-add/write`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anchorPersonId: quickAnchorPersonId,
            relationshipKind: quickRelationship,
            mode,
            existingPersonId: existingPersonId || null,
            fullName: mode === "create_new" ? quickName.trim() : null,
            sex: mode === "create_new" ? quickSex : null,
            locationText:
              mode === "create_new" ? quickLocationText.trim() : null,
            locationScope:
              mode === "create_new" ? quickLocationScope : null,
            locationBucket:
              mode === "create_new" ? quickLocationBucket.trim() : null,
          }),
        }
      );

      const data = (await response.json()) as QuickEntryWriteResponse;

      if (!response.ok || !data.success) {
        setQuickWriteError(data.error || "Quick Entry failed.");
        return;
      }

      setQuickWriteSuccess(data.message || "Quick Entry saved.");

      if (mode === "create_new") {
        resetQuickNewPersonFields();
      } else {
        setQuickName("");
        setQuickCurrentMatches([]);
        setQuickOtherMatches([]);
        setQuickCreateOverride(false);
      }

      await loadFamily();
      setGenerationRefreshKey((current) => current + 1);
      setChartEntryOpen(false);

      if (data.personId) {
        setChartActivePersonId(data.personId);
        setQuickAnchorPersonId(data.personId);
      }

      if (expandedEventId) {
        await loadParticipation(expandedEventId);
      }
    } catch (error) {
      setQuickWriteError(
        error instanceof Error ? error.message : "Quick Entry failed."
      );
    } finally {
      setQuickWriting(false);
    }
  }

  async function saveDisplayRoot() {
    setRootError(null);
    setRootSuccess(null);
    setSavingRoot(true);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(familyId)}/root`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rootPersonId: selectedRootPersonId || null,
          }),
        }
      );

      const data = (await response.json()) as {
        success: boolean;
        error?: string;
        family?: {
          displayRootPersonId: string | null;
        };
      };

      if (!response.ok || !data.success || !data.family) {
        setRootError(data.error || "Failed to update family tree root.");
        return;
      }

      setDisplayRootPersonId(data.family.displayRootPersonId || null);
      setSelectedRootPersonId(data.family.displayRootPersonId || "");
      setRootSuccess(
        data.family.displayRootPersonId
          ? "Family Tree Root updated."
          : "Family Tree Root cleared."
      );
    } catch (error) {
      setRootError(
        error instanceof Error
          ? error.message
          : "Failed to update family tree root."
      );
    } finally {
      setSavingRoot(false);
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

  const displayRootPerson = React.useMemo(
    () =>
      people.find((person) => person.id === displayRootPersonId) || null,
    [people, displayRootPersonId]
  );

  const quickHasMatches =
    quickCurrentMatches.length > 0 || quickOtherMatches.length > 0;

  const quickHasExactNameMatch = React.useMemo(() => {
    const normalizedQuickName = quickName.trim().toLowerCase();

    if (!normalizedQuickName) return false;

    return [...quickCurrentMatches, ...quickOtherMatches].some(
      (candidate) =>
        candidate.fullName.trim().toLowerCase() === normalizedQuickName
    );
  }, [quickCurrentMatches, quickOtherMatches, quickName]);

  const quickAnchorPerson = React.useMemo(
    () => people.find((person) => person.id === quickAnchorPersonId) || null,
    [people, quickAnchorPersonId]
  );

  const quickAnchorGeneration = quickAnchorPersonId
    ? generationByPersonId[quickAnchorPersonId] || null
    : null;

  const exactCurrentMatches = React.useMemo(
    () =>
      quickCurrentMatches.filter(
        (candidate) =>
          candidate.fullName.trim().toLowerCase() ===
          quickName.trim().toLowerCase()
      ),
    [quickCurrentMatches, quickName]
  );

  const otherCurrentMatches = React.useMemo(
    () =>
      quickCurrentMatches.filter(
        (candidate) =>
          candidate.fullName.trim().toLowerCase() !==
          quickName.trim().toLowerCase()
      ),
    [quickCurrentMatches, quickName]
  );

  const chartActivePerson = React.useMemo(
    () => people.find((person) => person.id === chartActivePersonId) || null,
    [chartActivePersonId, people]
  );

  const chartPeople = React.useMemo(
    () =>
      [...people].sort((a, b) => {
        const generationA = generationByPersonId[a.id] || 999;
        const generationB = generationByPersonId[b.id] || 999;

        if (generationA !== generationB) {
          return generationA - generationB;
        }

        return a.fullName.localeCompare(b.fullName, "en");
      }),
    [generationByPersonId, people]
  );

  function activateChartEntry(
    personId: string,
    relationship: "child" | "spouse"
  ) {
    setChartActivePersonId(personId);
    setQuickAnchorPersonId(personId);
    setQuickRelationship(relationship);
    setQuickName("");
    setQuickCurrentMatches([]);
    setQuickOtherMatches([]);
    setQuickCreateOverride(false);
    setQuickWriteError(null);
    setQuickWriteSuccess(null);
    setChartEntryOpen(true);
  }

  const quickLocationBucketHint = React.useMemo(() => {
    if (quickLocationScope === "ifugao_municipality") {
      return "Choose the Ifugao municipality.";
    }

    if (quickLocationScope === "philippines_ncr") {
      return "NCR is used automatically.";
    }

    if (quickLocationScope === "philippines_province") {
      return "Enter the province, for example Nueva Vizcaya.";
    }

    if (quickLocationScope === "overseas_country") {
      return "Enter the country, for example Canada.";
    }

    return "Location classification is optional.";
  }, [quickLocationScope]);

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
                Family Tree Root
              </p>
              <h2 className="mt-2 text-2xl font-black">
                Generation Anchor
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                This person is Generation 1 for Quick Entry and Generation
                View. Generation numbers are derived from the genealogy graph
                and are never stored on individual people.
              </p>

              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  Current Root
                </p>
                <p className="mt-2 font-black text-white">
                  {displayRootPerson
                    ? displayRootPerson.fullName
                    : "Not selected"}
                </p>
                {displayRootPerson?.locationBucket ? (
                  <p className="mt-1 text-sm text-slate-400">
                    {displayRootPerson.locationBucket}
                  </p>
                ) : null}
              </div>

              {people.length > 0 ? (
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <select
                    value={selectedRootPersonId}
                    onChange={(event) => {
                      setSelectedRootPersonId(event.target.value);
                      setRootError(null);
                      setRootSuccess(null);
                    }}
                    className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                  >
                    <option value="">No root selected</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {personLabel(person)}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => void saveDisplayRoot()}
                    disabled={
                      savingRoot ||
                      selectedRootPersonId === (displayRootPersonId || "")
                    }
                    className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
                  >
                    {savingRoot ? "Saving..." : "Save Family Tree Root"}
                  </button>
                </div>
              ) : (
                <p className="mt-5 text-sm text-slate-400">
                  Add at least one family member before selecting a Family Tree
                  Root.
                </p>
              )}

              {rootError ? (
                <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                  {rootError}
                </div>
              ) : null}

              {rootSuccess ? (
                <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
                  {rootSuccess}
                </div>
              ) : null}
            </section>

            <section className="mt-8 rounded-3xl border border-cyan-300/20 bg-slate-900 p-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
                Family Branch Entry
              </p>
              <h2 className="mt-2 text-2xl font-black">
                Build the Family from a Person
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Choose a person, then add a child or spouse directly from that
                person's card. Generation labels are derived from the Family
                Tree Root.
              </p>

              {people.length === 0 ? (
                <p className="mt-5 text-sm text-slate-400">
                  Add the first family member in Advanced Genealogy Editor.
                </p>
              ) : (
                <>
                  <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                    <label>
                      <span className="text-xs font-bold text-slate-300">
                        Current Person
                      </span>
                      <select
                        value={chartActivePersonId}
                        onChange={(event) => {
                          const personId = event.target.value;
                          setChartActivePersonId(personId);
                          setQuickAnchorPersonId(personId);
                          setQuickName("");
                          setQuickCurrentMatches([]);
                          setQuickOtherMatches([]);
                          setQuickCreateOverride(false);
                          setQuickWriteError(null);
                          setQuickWriteSuccess(null);
                        }}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                      >
                        {chartPeople.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.fullName}
                            {generationByPersonId[person.id]
                              ? ` - Generation ${generationByPersonId[person.id]}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    <Link
                      href={`/admin/events/family-reunions/${familyId}/tree`}
                      className="rounded-xl border border-amber-300/40 px-4 py-3 text-center text-sm font-black text-amber-300"
                    >
                      Open Full Tree
                    </Link>
                  </div>

                  {chartActivePerson ? (
                    <div className="mt-5 flex justify-center">
                      <div className="w-full max-w-xl rounded-2xl border border-cyan-300/30 bg-slate-950 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xl font-black text-white">
                              {chartActivePerson.fullName}
                            </p>
                            <p className="mt-1 text-sm text-slate-400">
                              {chartActivePerson.locationText ||
                                chartActivePerson.locationBucket ||
                                "Location not recorded"}
                            </p>
                          </div>

                          {generationByPersonId[chartActivePerson.id] ? (
                            <span className="rounded-full bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-300">
                              Generation {generationByPersonId[chartActivePerson.id]}
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-400">
                              Outside root path
                            </span>
                          )}
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              activateChartEntry(chartActivePerson.id, "child")
                            }
                            className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950"
                          >
                            + Child
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              activateChartEntry(chartActivePerson.id, "spouse")
                            }
                            className="rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-3 text-sm font-black text-rose-200"
                          >
                            + Spouse
                          </button>
                        </div>

                        {chartEntryOpen ? (
                          <div className="mt-5 border-t border-slate-800 pt-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-300">
                                  {quickRelationship === "child"
                                    ? `Add Child of ${chartActivePerson.fullName}`
                                    : `Add Spouse of ${chartActivePerson.fullName}`}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                  Search runs automatically before creation.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setChartEntryOpen(false);
                                  setQuickName("");
                                  setQuickCurrentMatches([]);
                                  setQuickOtherMatches([]);
                                  setQuickCreateOverride(false);
                                  setQuickWriteError(null);
                                  setQuickWriteSuccess(null);
                                }}
                                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-black text-slate-300"
                              >
                                Cancel
                              </button>
                            </div>

                            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
                              {quickRelationship === "child" &&
                              generationByPersonId[chartActivePerson.id] ? (
                                <>
                                  Generation{" "}
                                  <span className="font-black text-white">
                                    {generationByPersonId[chartActivePerson.id]}
                                  </span>
                                  {" -> "}
                                  child will appear as Generation{" "}
                                  <span className="font-black text-cyan-300">
                                    {generationByPersonId[chartActivePerson.id] + 1}
                                  </span>
                                </>
                              ) : quickRelationship === "spouse" ? (
                                "Spouse stays beside this person and does not create a new generation."
                              ) : (
                                "Generation preview is unavailable for this person."
                              )}
                            </div>

                            <label className="mt-4 block">
                              <span className="text-xs font-bold text-slate-300">
                                Person's Name
                              </span>
                              <input
                                value={quickName}
                                onChange={(event) => {
                                  setQuickName(event.target.value);
                                  setQuickCreateOverride(false);
                                  setQuickWriteError(null);
                                  setQuickWriteSuccess(null);
                                }}
                                placeholder={
                                  quickRelationship === "child"
                                    ? "Type the child's name"
                                    : "Type the spouse's name"
                                }
                                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white"
                              />
                            </label>

                            {quickSearching ? (
                              <p className="mt-3 text-xs text-slate-400">
                                Searching existing family records...
                              </p>
                            ) : null}

                            {quickSearchError ? (
                              <div className="mt-3 rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-200">
                                {quickSearchError}
                              </div>
                            ) : null}

                            {quickHasExactNameMatch ? (
                              <div className="mt-3 rounded-lg border border-red-700 bg-red-950/20 p-3 text-xs text-red-200">
                                Exact-name person already exists. Use the existing record below.
                              </div>
                            ) : null}

                            {!quickSearching &&
                            quickName.trim().length >= 2 &&
                            !quickSearchError &&
                            quickHasMatches ? (
                              <div className="mt-4 space-y-2">
                                {[...quickCurrentMatches, ...quickOtherMatches].map(
                                  (candidate) => {
                                    const hardCycle =
                                      candidate.quickAddDecision ===
                                      "CYCLE_WOULD_BE_CREATED";
                                    const needsAdvanced =
                                      candidate.quickAddDecision ===
                                      "ADVANCED_EDITOR_REQUIRED";
                                    const alreadyLinked =
                                      candidate.quickAddDecision ===
                                      "ALREADY_LINKED";
                                    const canUse =
                                      quickRelationship === "spouse"
                                        ? candidate.candidateId !==
                                          quickAnchorPersonId
                                        : candidate.quickAddDecision ===
                                          "SAFE_TO_LINK";

                                    return (
                                      <div
                                        key={`chart:${candidate.candidateId}`}
                                        className={`rounded-xl border p-3 ${
                                          hardCycle
                                            ? "border-red-700 bg-red-950/20"
                                            : needsAdvanced
                                            ? "border-amber-700 bg-amber-950/10"
                                            : "border-slate-700 bg-slate-900"
                                        }`}
                                      >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                          <div>
                                            <p className="text-sm font-black text-white">
                                              {candidate.fullName}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-400">
                                              {candidate.locationBucket ||
                                                candidate.locationText ||
                                                "Location not recorded"}
                                            </p>
                                            {candidate.matchScope ===
                                            "OTHER_FAMILY" ? (
                                              <p className="mt-1 text-[11px] text-amber-300">
                                                Organized under:{" "}
                                                {candidate.organizationalFamily
                                                  ?.name || "Unassigned family"}
                                              </p>
                                            ) : null}
                                          </div>
                                          <span className="text-[11px] text-slate-500">
                                            {Math.round(
                                              candidate.similarityScore * 100
                                            )}
                                            % match
                                          </span>
                                        </div>

                                        {candidate.fullName
                                          .trim()
                                          .toLowerCase() !==
                                        quickName.trim().toLowerCase() ? (
                                          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950 p-3">
                                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                                              Possible Same Person
                                            </p>
                                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                              <div>
                                                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                                                  Existing Record
                                                </p>
                                                <p className="mt-1 text-xs font-black text-white">
                                                  {candidate.fullName}
                                                </p>
                                              </div>
                                              <div>
                                                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                                                  You Entered
                                                </p>
                                                <p className="mt-1 text-xs font-black text-white">
                                                  {quickName.trim()}
                                                </p>
                                              </div>
                                            </div>
                                            <p className="mt-2 text-[11px] leading-5 text-slate-400">
                                              Similar names may still be different
                                              people. Suffixes such as Jr., Sr.,
                                              II, III, IV, and middle names can be
                                              identity-significant.
                                            </p>
                                          </div>
                                        ) : null}

                                        {hardCycle ? (
                                          <div className="mt-3 rounded-lg border border-red-800 bg-red-950/30 p-3">
                                            <p className="text-xs font-black text-red-200">
                                              Linking this existing record is not allowed.
                                            </p>
                                            <p className="mt-1 text-[11px] leading-5 text-red-100/80">
                                              Using {candidate.fullName} here would
                                              create an ancestry cycle. This does not
                                              mean the name you entered is invalid. If
                                              this is genuinely another person, you may
                                              continue creating a separate record.
                                            </p>
                                          </div>
                                        ) : needsAdvanced ? (
                                          <div className="mt-3 rounded-lg border border-amber-800 bg-amber-950/20 p-3">
                                            <p className="text-xs font-black text-amber-200">
                                              Existing record needs review before linking.
                                            </p>
                                            <p className="mt-1 text-[11px] leading-5 text-amber-100/80">
                                              This person already has two or more
                                              biological parents. Review the relationship
                                              in Advanced Genealogy Editor.
                                            </p>
                                          </div>
                                        ) : alreadyLinked ? (
                                          <p className="mt-3 text-xs text-slate-400">
                                            This relationship already exists.
                                          </p>
                                        ) : canUse ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void runQuickEntry(
                                                "use_existing",
                                                candidate.candidateId
                                              )
                                            }
                                            disabled={quickWriting}
                                            className="mt-3 rounded-lg bg-emerald-300 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
                                          >
                                            Use Existing {candidate.fullName}
                                          </button>
                                        ) : null}
                                      </div>
                                    );
                                  }
                                )}
                              </div>
                            ) : null}

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <label>
                                <span className="text-xs font-bold text-slate-300">
                                  Sex
                                </span>
                                <select
                                  value={quickSex}
                                  onChange={(event) =>
                                    setQuickSex(event.target.value)
                                  }
                                  disabled={
                                    quickHasExactNameMatch ||
                                    (quickHasMatches && !quickCreateOverride)
                                  }
                                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white disabled:opacity-40"
                                >
                                  <option value="unspecified">Unspecified</option>
                                  <option value="male">Male</option>
                                  <option value="female">Female</option>
                                </select>
                              </label>

                              <label>
                                <span className="text-xs font-bold text-slate-300">
                                  Detailed Place
                                </span>
                                <input
                                  value={quickLocationText}
                                  onChange={(event) =>
                                    setQuickLocationText(event.target.value)
                                  }
                                  disabled={
                                    quickHasExactNameMatch ||
                                    (quickHasMatches && !quickCreateOverride)
                                  }
                                  placeholder="Example: Lagawe or Quezon City"
                                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white disabled:opacity-40"
                                />
                              </label>
                            </div>

                            {quickHasMatches &&
                            !quickHasExactNameMatch &&
                            !quickCreateOverride ? (
                              <div className="mt-4 rounded-lg border border-amber-700 bg-amber-950/20 p-3">
                                <p className="text-xs text-amber-200">
                                  Existing records may match this person. Use an
                                  existing record above when appropriate.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setQuickCreateOverride(true)}
                                  className="mt-2 rounded-lg border border-amber-500 px-3 py-2 text-xs font-black text-amber-200"
                                >
                                  This Is A Different Person
                                </button>
                              </div>
                            ) : null}

                            <button
                              type="button"
                              onClick={() => void runQuickEntry("create_new")}
                              disabled={
                                quickWriting ||
                                !quickName.trim() ||
                                quickHasExactNameMatch ||
                                (quickHasMatches && !quickCreateOverride)
                              }
                              className="mt-4 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
                            >
                              {quickWriting
                                ? "Saving..."
                                : quickRelationship === "child"
                                ? `Create ${quickName.trim() || "Person"} as Child`
                                : `Create ${quickName.trim() || "Person"} as Spouse`}
                            </button>

                            {quickWriteError ? (
                              <div className="mt-3 rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-200">
                                {quickWriteError}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-6">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                      Family Members
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {chartPeople.map((person) => (
                        <button
                          key={person.id}
                          type="button"
                          onClick={() => {
                            setChartActivePersonId(person.id);
                            setQuickAnchorPersonId(person.id);
                            setQuickName("");
                            setQuickCurrentMatches([]);
                            setQuickOtherMatches([]);
                            setQuickCreateOverride(false);
                            setQuickWriteError(null);
                            setQuickWriteSuccess(null);
                          }}
                          className={`rounded-xl border p-4 text-left transition ${
                            chartActivePersonId === person.id
                              ? "border-cyan-300 bg-cyan-950/20"
                              : "border-slate-800 bg-slate-950 hover:border-slate-600"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
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
                            {generationByPersonId[person.id] ? (
                              <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.08em] text-amber-300">
                                G{generationByPersonId[person.id]}
                              </span>
                            ) : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </section>

            <section id="quick-family-entry-form" className="mt-8 rounded-3xl border border-cyan-300/20 bg-slate-900 p-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
                Quick Family Entry
              </p>
              <h2 className="mt-2 text-2xl font-black">
                Add a Child or Spouse
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Search existing family records before creating a new person.
                New-person creation and the relationship are saved together in
                one database operation.
              </p>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <div>
                  <label className="text-xs font-bold text-slate-300">
                    Add to
                  </label>
                  <select
                    value={quickAnchorPersonId}
                    onChange={(event) => {
                      setQuickAnchorPersonId(event.target.value);
                      setChartActivePersonId(event.target.value);
                      setQuickCreateOverride(false);
                      setQuickWriteError(null);
                      setQuickWriteSuccess(null);
                    }}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                  >
                    <option value="">Choose family member</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {personLabel(person)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-xs font-bold text-slate-300">
                    Relationship
                  </p>
                  <div className="mt-2 grid grid-cols-2 rounded-xl border border-slate-700 bg-slate-950 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setQuickRelationship("child");
                        setQuickCreateOverride(false);
                        setQuickWriteError(null);
                        setQuickWriteSuccess(null);
                      }}
                      className={`rounded-lg px-3 py-2 text-sm font-black ${
                        quickRelationship === "child"
                          ? "bg-cyan-300 text-slate-950"
                          : "text-slate-300"
                      }`}
                    >
                      Child
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickRelationship("spouse");
                        setQuickCreateOverride(false);
                        setQuickWriteError(null);
                        setQuickWriteSuccess(null);
                      }}
                      className={`rounded-lg px-3 py-2 text-sm font-black ${
                        quickRelationship === "spouse"
                          ? "bg-cyan-300 text-slate-950"
                          : "text-slate-300"
                      }`}
                    >
                      Spouse
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  Generation Preview
                </p>

                {!displayRootPersonId ? (
                  <p className="mt-2 text-sm text-amber-300">
                    Select a Family Tree Root to enable generation preview.
                  </p>
                ) : generationLoading ? (
                  <p className="mt-2 text-sm text-slate-400">
                    Calculating generations...
                  </p>
                ) : quickRelationship === "child" &&
                  quickAnchorPerson &&
                  quickAnchorGeneration ? (
                  <p className="mt-2 text-sm text-slate-300">
                    {quickAnchorPerson.fullName} is Generation{" "}
                    <span className="font-black text-white">
                      {quickAnchorGeneration}
                    </span>
                    . A child added here will appear as Generation{" "}
                    <span className="font-black text-cyan-300">
                      {quickAnchorGeneration + 1}
                    </span>
                    .
                  </p>
                ) : quickRelationship === "spouse" ? (
                  <p className="mt-2 text-sm text-slate-400">
                    A spouse is displayed with the selected person and does not
                    create a new generation.
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">
                    The selected person is not currently reachable from the
                    Family Tree Root within the five-generation view.
                  </p>
                )}
              </div>

              <label className="mt-5 block">
                <span className="text-xs font-bold text-slate-300">
                  Person's Name
                </span>
                <input
                  value={quickName}
                  onChange={(event) => {
                    setQuickName(event.target.value);
                    setQuickCreateOverride(false);
                    setQuickWriteError(null);
                    setQuickWriteSuccess(null);
                  }}
                  placeholder="Type the child's or spouse's name"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                />
              </label>

              {quickHasExactNameMatch ? (
                <div className="mt-4 rounded-xl border border-red-700 bg-red-950/20 p-4">
                  <p className="text-sm font-black text-red-200">
                    Exact-name person already exists.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-red-100/80">
                    {[...quickCurrentMatches, ...quickOtherMatches].some(
                      (candidate) =>
                        candidate.fullName.trim().toLowerCase() ===
                          quickName.trim().toLowerCase() &&
                        candidate.quickAddDecision === "ALREADY_LINKED"
                    )
                      ? `${quickName.trim()} already exists and this relationship is already recorded. No action is needed.`
                      : "Use the existing record shown below. Normal Quick Entry will not create another person with this exact name."}
                  </p>
                </div>
              ) : null}

              {quickSearching ? (
                <p className="mt-4 text-sm text-slate-400">
                  Searching existing family records...
                </p>
              ) : null}

              {quickSearchError ? (
                <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                  {quickSearchError}
                </div>
              ) : null}

              {!quickSearching &&
              quickName.trim().length >= 2 &&
              !quickSearchError ? (
                <div className="mt-5 space-y-5">
                  {[...exactCurrentMatches, ...otherCurrentMatches].length > 0 ? (
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-300">
                        Possible Matches in This Family
                      </p>
                      <div className="mt-2 space-y-2">
                        {[...exactCurrentMatches, ...otherCurrentMatches].map(
                          (candidate) => {
                            const hardCycle =
                              candidate.quickAddDecision ===
                              "CYCLE_WOULD_BE_CREATED";
                            const needsAdvanced =
                              candidate.quickAddDecision ===
                              "ADVANCED_EDITOR_REQUIRED";
                            const alreadyLinked =
                              candidate.quickAddDecision === "ALREADY_LINKED";
                            const canUse =
                              quickRelationship === "spouse"
                                ? candidate.candidateId !== quickAnchorPersonId
                                : candidate.quickAddDecision === "SAFE_TO_LINK";

                            return (
                              <div
                                key={candidate.candidateId}
                                className={`rounded-xl border p-4 ${
                                  hardCycle
                                    ? "border-red-700 bg-red-950/20"
                                    : needsAdvanced
                                    ? "border-amber-700 bg-amber-950/10"
                                    : "border-slate-700 bg-slate-950"
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="font-black text-white">
                                      {candidate.fullName}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-400">
                                      {candidate.locationBucket ||
                                        candidate.locationText ||
                                        "Location not recorded"}
                                    </p>
                                    <p className="mt-2 text-xs text-slate-500">
                                      Similarity:{" "}
                                      {Math.round(
                                        candidate.similarityScore * 100
                                      )}
                                      %
                                    </p>
                                    {quickRelationship === "child" ? (
                                      <p className="mt-1 text-xs text-slate-500">
                                        Biological parents:{" "}
                                        {candidate.biologicalParentCount}
                                      </p>
                                    ) : null}
                                  </div>

                                  {hardCycle ? (
                                    <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-red-300">
                                      Cannot Link
                                    </span>
                                  ) : needsAdvanced ? (
                                    <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-amber-300">
                                      Review Required
                                    </span>
                                  ) : alreadyLinked ? (
                                    <span className="rounded-full bg-slate-700 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                                      Already Linked
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-300">
                                      Possible Existing Person
                                    </span>
                                  )}
                                </div>

                                {hardCycle ? (
                                  <div className="mt-3 rounded-lg border border-red-800 bg-red-950/30 p-3 text-xs text-red-200">
                                    Cannot add this relationship. It would
                                    create an ancestry loop.
                                  </div>
                                ) : needsAdvanced ? (
                                  <div className="mt-3 rounded-lg border border-amber-800 bg-amber-950/20 p-3 text-xs text-amber-200">
                                    This person already has two or more
                                    biological parents. Review the relationship
                                    in Advanced Genealogy Editor.
                                  </div>
                                ) : canUse ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void runQuickEntry(
                                        "use_existing",
                                        candidate.candidateId
                                      )
                                    }
                                    disabled={quickWriting}
                                    className="mt-3 rounded-lg bg-emerald-300 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
                                  >
                                    {quickWriting
                                      ? "Saving..."
                                      : `Use Existing ${candidate.fullName}`}
                                  </button>
                                ) : null}
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  ) : null}

                  {quickOtherMatches.length > 0 ? (
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-300">
                        Possible Matches in Other Family Projects
                      </p>
                      <div className="mt-2 space-y-2">
                        {quickOtherMatches.map((candidate) => {
                          const hardCycle =
                            candidate.quickAddDecision ===
                            "CYCLE_WOULD_BE_CREATED";
                          const needsAdvanced =
                            candidate.quickAddDecision ===
                            "ADVANCED_EDITOR_REQUIRED";
                          const alreadyLinked =
                            candidate.quickAddDecision === "ALREADY_LINKED";
                          const canUse =
                            quickRelationship === "spouse"
                              ? candidate.candidateId !== quickAnchorPersonId
                              : candidate.quickAddDecision === "SAFE_TO_LINK";

                          return (
                            <div
                              key={candidate.candidateId}
                              className={`rounded-xl border p-4 ${
                                hardCycle
                                  ? "border-red-700 bg-red-950/20"
                                  : needsAdvanced
                                  ? "border-amber-700 bg-amber-950/10"
                                  : "border-amber-300/20 bg-slate-950"
                              }`}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="font-black text-white">
                                    {candidate.fullName}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {candidate.locationBucket ||
                                      candidate.locationText ||
                                      "Location not recorded"}
                                  </p>
                                  <p className="mt-2 text-xs text-amber-200">
                                    Organized under:{" "}
                                    {candidate.organizationalFamily?.name ||
                                      "Unassigned family"}
                                  </p>
                                  {quickRelationship === "child" ? (
                                    <p className="mt-1 text-xs text-slate-500">
                                      Biological parents:{" "}
                                      {candidate.biologicalParentCount}
                                    </p>
                                  ) : null}
                                </div>

                                <span className="text-xs text-slate-500">
                                  {Math.round(candidate.similarityScore * 100)}%
                                  match
                                </span>
                              </div>

                              {hardCycle ? (
                                <div className="mt-3 rounded-lg border border-red-800 bg-red-950/30 p-3 text-xs text-red-200">
                                  Cannot add this relationship. It would
                                  create an ancestry loop.
                                </div>
                              ) : needsAdvanced ? (
                                <div className="mt-3 rounded-lg border border-amber-800 bg-amber-950/20 p-3 text-xs text-amber-200">
                                  Review required. This person already has two
                                  or more biological parents.
                                </div>
                              ) : alreadyLinked ? (
                                <p className="mt-3 text-xs text-slate-400">
                                  This relationship already exists.
                                </p>
                              ) : canUse ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void runQuickEntry(
                                      "use_existing",
                                      candidate.candidateId
                                    )
                                  }
                                  disabled={quickWriting}
                                  className="mt-3 rounded-lg bg-emerald-300 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
                                >
                                  {quickWriting
                                    ? "Saving..."
                                    : `Use Existing ${candidate.fullName}`}
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950 p-5">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-white">
                  Create New Person
                </p>

                {quickHasExactNameMatch ? (
                  <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
                    <p className="text-xs font-bold text-slate-400">
                      Creation is disabled because an exact-name record exists above.
                    </p>
                  </div>
                ) : quickHasMatches && !quickCreateOverride ? (
                  <div className="mt-3 rounded-xl border border-amber-700 bg-amber-950/20 p-4">
                    <p className="text-sm font-black text-amber-200">
                      Existing records may match this person.
                    </p>
                    <p className="mt-2 text-xs leading-5 text-amber-100/80">
                      Use an existing person above when it is the same
                      individual. Create another record only when this is
                      genuinely a different person with a similar name.
                    </p>
                    <button
                      type="button"
                      onClick={() => setQuickCreateOverride(true)}
                      className="mt-3 rounded-lg border border-amber-500 px-3 py-2 text-xs font-black text-amber-200"
                    >
                      Create a Different Person Anyway
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    {quickCreateOverride
                      ? "Duplicate warning acknowledged. Confirm the details below before creating a separate person."
                      : "No existing match is currently blocking new-person entry."}
                  </p>
                )}

                <div
                  className={`mt-4 grid gap-4 sm:grid-cols-2 ${
                    quickHasExactNameMatch ||
                    (quickHasMatches && !quickCreateOverride)
                      ? "pointer-events-none opacity-40"
                      : ""
                  }`}
                >
                  <label>
                    <span className="text-xs font-bold text-slate-300">
                      Sex
                    </span>
                    <select
                      value={quickSex}
                      onChange={(event) => setQuickSex(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white"
                    >
                      <option value="unspecified">Unspecified</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </label>

                  <label>
                    <span className="text-xs font-bold text-slate-300">
                      Detailed Place
                    </span>
                    <input
                      value={quickLocationText}
                      onChange={(event) =>
                        setQuickLocationText(event.target.value)
                      }
                      placeholder="Example: Lagawe or Quezon City"
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white"
                    />
                  </label>

                  <label>
                    <span className="text-xs font-bold text-slate-300">
                      Reporting Classification
                    </span>
                    <select
                      value={quickLocationScope}
                      onChange={(event) => {
                        const next = event.target.value;
                        setQuickLocationScope(next);
                        setQuickLocationBucket(
                          next === "philippines_ncr" ? "NCR" : ""
                        );
                      }}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white"
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
                    {quickLocationScope === "ifugao_municipality" ? (
                      <select
                        value={quickLocationBucket}
                        onChange={(event) =>
                          setQuickLocationBucket(event.target.value)
                        }
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white"
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
                        value={quickLocationBucket}
                        disabled={
                          !quickLocationScope ||
                          quickLocationScope === "philippines_ncr"
                        }
                        onChange={(event) =>
                          setQuickLocationBucket(event.target.value)
                        }
                        placeholder={
                          quickLocationScope === "philippines_province"
                            ? "Example: Nueva Vizcaya"
                            : quickLocationScope === "overseas_country"
                            ? "Example: Canada"
                            : ""
                        }
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white disabled:opacity-50"
                      />
                    )}
                    <p className="mt-2 text-[11px] text-slate-500">
                      {quickLocationBucketHint}
                    </p>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => void runQuickEntry("create_new")}
                  disabled={
                    quickWriting ||
                    !quickAnchorPersonId ||
                    !quickName.trim() ||
                    quickHasExactNameMatch ||
                    (quickHasMatches && !quickCreateOverride) ||
                    (Boolean(quickLocationScope) &&
                      !Boolean(quickLocationBucket))
                  }
                  className="mt-5 w-full rounded-xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
                >
                  {quickWriting
                    ? "Saving..."
                    : quickRelationship === "child"
                    ? `Create ${quickName.trim() || "Person"} as Child`
                    : `Create ${quickName.trim() || "Person"} as Spouse`}
                </button>
              </div>

              {quickWriteError ? (
                <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                  {quickWriteError}
                </div>
              ) : null}

              {quickWriteSuccess ? (
                <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
                  <p className="font-bold">{quickWriteSuccess}</p>
                  <p className="mt-1 text-xs text-emerald-100/80">
                    Ready to add another relative.
                  </p>
                </div>
              ) : null}
            </section>

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
