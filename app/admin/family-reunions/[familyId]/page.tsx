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
  pedigreeCollapseDetected?: boolean;
  multipleMinimumDepthPathsDetected?: boolean;
};

type FinderResponse = {
  success: boolean;
  error?: string;
  relationship?: RelationshipResult;
};

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

  const personA = React.useMemo(
    () => people.find((person) => person.id === personAId),
    [people, personAId]
  );

  const personB = React.useMemo(
    () => people.find((person) => person.id === personBId),
    [people, personBId]
  );

  React.useEffect(() => {
    let cancelled = false;

    async function loadFamily() {
      setLoading(true);
      setLoadError(null);

      try {
        const response = await fetch(
          `/api/family-reunions/${encodeURIComponent(familyId)}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data = (await response.json()) as FamilyResponse;

        if (cancelled) return;

        if (!response.ok || !data.success || !data.family) {
          setLoadError(data.error || "Failed to load family reunion.");
          setPeople([]);
          return;
        }

        setFamilyName(data.family.name);
        setFamilyDescription(data.family.description || "");
        setPeople(data.people || []);
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load family reunion."
        );
        setPeople([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadFamily();

    return () => {
      cancelled = true;
    };
  }, [familyId]);

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
        `/api/family-reunions/${encodeURIComponent(
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

  function swapPeople() {
    setPersonAId(personBId);
    setPersonBId(personAId);
    setRelationship(null);
    setFindError(null);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/admin/family-reunions"
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
            <div className="mt-6">
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

            <section className="mt-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black">Family Members</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {people.length} people currently assigned to this genealogy
                    project.
                  </p>
                </div>
              </div>

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

            {relationship && personA && personB ? (
              <section className="mt-6 rounded-3xl border border-amber-300/30 bg-slate-900 p-6">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                  Relationship Result
                </p>

                {relationship.resultCode === "FOUND" ? (
                  <>
                    <h2 className="mt-3 text-2xl font-black">
                      {personA.fullName} is{" "}
                      {relationship.relationshipAtoB || "related"} to{" "}
                      {personB.fullName}.
                    </h2>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          {personA.fullName} to {personB.fullName}
                        </p>
                        <p className="mt-2 text-lg font-black">
                          {relationship.relationshipAtoB}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          {personB.fullName} to {personA.fullName}
                        </p>
                        <p className="mt-2 text-lg font-black">
                          {relationship.relationshipBtoA}
                        </p>
                      </div>
                    </div>
                  </>
                ) : relationship.resultCode === "UNRELATED" ? (
                  <h2 className="mt-3 text-2xl font-black">
                    No biological relationship was found in the recorded tree.
                  </h2>
                ) : (
                  <>
                    <h2 className="mt-3 text-2xl font-black">
                      Complex shared ancestry detected.
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      The recorded genealogy contains multiple ancestry paths,
                      so JRide Events is not forcing a simplified cousin label.
                    </p>
                  </>
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
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
