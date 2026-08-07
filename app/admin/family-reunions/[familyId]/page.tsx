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

  const loadFamily = React.useCallback(async () => {
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
  }, [loadFamily]);

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
        `/api/family-reunions/${encodeURIComponent(familyId)}/people`,
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
        `/api/family-reunions/${encodeURIComponent(
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
                href={`/admin/family-reunions/${familyId}/tree`}
                className="rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950"
              >
                Open Family Tree
              </Link>
            </div>

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
