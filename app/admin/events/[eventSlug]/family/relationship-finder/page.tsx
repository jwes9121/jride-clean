"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type ReunionPerson = {
  id: string;
  fullName: string;
  nickname: string | null;
  sex: string | null;
  locationText: string | null;
  locationScope: string | null;
  locationBucket: string | null;
  attendeeId: string | null;
  registrationNumber: string | null;
};

type PeopleResponse = {
  success: boolean;
  error?: string;
  event?: {
    id: string;
    slug: string;
    name: string;
    shortName: string | null;
  };
  people?: ReunionPerson[];
};

type RelationshipResult = {
  success: boolean;
  resultCode?: string;
  relationshipClass?: string;
  relationshipAtoB?: string;
  relationshipBtoA?: string;
  fullOrHalf?: string | null;
  personAId?: string;
  personBId?: string;
  personAName?: string | null;
  personBName?: string | null;
  nearestCommonAncestors?: {
    ancestorId: string | null;
    fullName: string | null;
    depthA: number;
    depthB: number;
  }[];
  pedigreeCollapseDetected?: boolean;
  multipleMinimumDepthPathsDetected?: boolean;
};

type FinderResponse = {
  success: boolean;
  error?: string;
  relationship?: RelationshipResult;
};

function personLabel(person: ReunionPerson) {
  const parts = [person.fullName];

  if (person.nickname) {
    parts.push(`"${person.nickname}"`);
  }

  if (person.locationBucket) {
    parts.push(`- ${person.locationBucket}`);
  }

  return parts.join(" ");
}

function relationshipTitle(
  personA: ReunionPerson | undefined,
  relationship: RelationshipResult | null,
  personB: ReunionPerson | undefined
) {
  if (!personA || !personB || !relationship) return "";

  if (relationship.resultCode === "UNRELATED") {
    return `${personA.fullName} and ${personB.fullName} have no biological relationship found in the recorded tree.`;
  }

  if (relationship.resultCode === "COMPLEX_SHARED_ANCESTRY") {
    return `${personA.fullName} and ${personB.fullName} have complex shared ancestry.`;
  }

  return `${personA.fullName} is ${relationship.relationshipAtoB || "related"} to ${personB.fullName}.`;
}

export default function FamilyRelationshipFinderPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = params.eventSlug;

  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [eventName, setEventName] = React.useState("");
  const [people, setPeople] = React.useState<ReunionPerson[]>([]);

  const [personAId, setPersonAId] = React.useState("");
  const [personBId, setPersonBId] = React.useState("");

  const [finding, setFinding] = React.useState(false);
  const [findError, setFindError] = React.useState<string | null>(null);
  const [relationship, setRelationship] =
    React.useState<RelationshipResult | null>(null);

  const personA = React.useMemo(
    () => people.find((person) => person.id === personAId),
    [people, personAId]
  );

  const personB = React.useMemo(
    () => people.find((person) => person.id === personBId),
    [people, personBId]
  );

  const loadPeople = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(
          eventSlug
        )}/family/relationship-finder`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data = (await response.json()) as PeopleResponse;

      if (!response.ok || !data.success) {
        setLoadError(data.error || "Failed to load reunion people.");
        setPeople([]);
        return;
      }

      setEventName(data.event?.shortName || data.event?.name || eventSlug);
      setPeople(data.people || []);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to load reunion people."
      );
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, [eventSlug]);

  React.useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

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
        `/api/events/${encodeURIComponent(
          eventSlug
        )}/family/relationship-finder`,
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

  function swapPeople() {
    setPersonAId(personBId);
    setPersonBId(personAId);
    setRelationship(null);
    setFindError(null);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
          JRide Events
        </p>

        <h1 className="mt-3 text-3xl font-black">
          Family Relationship Finder
        </h1>

        <p className="mt-2 text-sm leading-6 text-slate-400">
          {eventName
            ? `${eventName} - select two linked family members to see how they are related.`
            : "Select two linked family members to see how they are related."}
        </p>

        <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-6">
          {loading ? (
            <p className="text-sm text-slate-400">Loading family members...</p>
          ) : loadError ? (
            <div className="rounded-2xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
              {loadError}
            </div>
          ) : people.length === 0 ? (
            <div className="rounded-2xl border border-amber-800 bg-amber-950/30 p-4">
              <p className="font-bold text-amber-200">
                No family members are linked to this reunion yet.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Relationship Finder only searches people already linked through
                the reunion genealogy records. It does not search unrelated
                family projects or the entire genealogy database.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
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
                  onClick={swapPeople}
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
                {finding ? "Finding relationship..." : "Find Relationship"}
              </button>
            </>
          )}

          {findError ? (
            <div className="mt-5 rounded-2xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
              {findError}
            </div>
          ) : null}
        </div>

        {relationship && personA && personB ? (
          <section className="mt-6 rounded-3xl border border-amber-300/30 bg-slate-900 p-6">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
              Relationship Result
            </p>

            <h2 className="mt-3 text-2xl font-black">
              {relationshipTitle(personA, relationship, personB)}
            </h2>

            {relationship.resultCode === "FOUND" ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                    {personA.fullName} to {personB.fullName}
                  </p>
                  <p className="mt-2 text-lg font-black text-white">
                    {relationship.relationshipAtoB || "Related"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                    {personB.fullName} to {personA.fullName}
                  </p>
                  <p className="mt-2 text-lg font-black text-white">
                    {relationship.relationshipBtoA || "Related"}
                  </p>
                </div>
              </div>
            ) : null}

            {relationship.resultCode === "COMPLEX_SHARED_ANCESTRY" ? (
              <div className="mt-5 rounded-2xl border border-amber-800 bg-amber-950/30 p-4 text-sm leading-6 text-amber-100">
                The recorded family tree contains multiple ancestry paths, so
                JRide Events is not forcing a simplified cousin label. The
                common-ancestor evidence is shown below.
              </div>
            ) : null}

            {(relationship.nearestCommonAncestors || []).length > 0 ? (
              <div className="mt-6">
                <h3 className="font-black text-white">
                  Nearest Common Ancestor
                  {(relationship.nearestCommonAncestors || []).length > 1
                    ? "s"
                    : ""}
                </h3>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(relationship.nearestCommonAncestors || []).map(
                    (ancestor, index) => (
                      <div
                        key={ancestor.ancestorId || `${index}`}
                        className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
                      >
                        <p className="font-bold text-white">
                          {ancestor.fullName || "Recorded ancestor"}
                        </p>
                        <p className="mt-1 text-sm text-slate-400">
                          {personA.fullName}: {ancestor.depthA} generation
                          {ancestor.depthA === 1 ? "" : "s"} away
                        </p>
                        <p className="text-sm text-slate-400">
                          {personB.fullName}: {ancestor.depthB} generation
                          {ancestor.depthB === 1 ? "" : "s"} away
                        </p>
                      </div>
                    )
                  )}
                </div>
              </div>
            ) : null}

            <p className="mt-5 text-xs leading-5 text-slate-500">
              Biological parent-child relationships are used for this result.
              Step and adoptive relationships remain stored separately and are
              not silently treated as blood relationships.
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
