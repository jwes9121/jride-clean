"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type RootOption = {
  id: string;
  fullName: string;
  nickname: string | null;
  locationText: string | null;
  locationBucket: string | null;
  suggestedRoot: boolean;
};

type TreePerson = {
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
  parentIds: string[];
  spouses: {
    personId: string;
    fullName: string;
    status: string;
  }[];
};

type TreeGeneration = {
  generation: number;
  people: TreePerson[];
};

type TreeResponse = {
  success: boolean;
  error?: string;
  family?: {
    id: string;
    name: string;
    description: string | null;
  };
  rootOptions?: RootOption[];
  selectedRootId?: string | null;
  generationLimit?: number;
  generations?: TreeGeneration[];
};

function locationLabel(person: TreePerson) {
  if (person.locationBucket && person.locationText) {
    if (person.locationBucket === person.locationText) {
      return person.locationText;
    }

    return `${person.locationText} - ${person.locationBucket}`;
  }

  return person.locationText || person.locationBucket || "Location not recorded";
}

export default function FamilyTreePage() {
  const params = useParams<{ familyId: string }>();
  const familyId = params.familyId;

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [familyName, setFamilyName] = React.useState("");
  const [familyDescription, setFamilyDescription] = React.useState("");
  const [rootOptions, setRootOptions] = React.useState<RootOption[]>([]);
  const [selectedRootId, setSelectedRootId] = React.useState("");
  const [generationLimit, setGenerationLimit] = React.useState(5);
  const [generations, setGenerations] = React.useState<TreeGeneration[]>([]);

  const loadTree = React.useCallback(
    async (rootPersonId?: string, generationsToShow = generationLimit) => {
      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams();
        query.set("generations", String(generationsToShow));

        if (rootPersonId) {
          query.set("rootPersonId", rootPersonId);
        }

        const response = await fetch(
          `/api/family-reunions/${encodeURIComponent(
            familyId
          )}/tree?${query.toString()}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data = (await response.json()) as TreeResponse;

        if (!response.ok || !data.success || !data.family) {
          setError(data.error || "Failed to load family tree.");
          setGenerations([]);
          return;
        }

        setFamilyName(data.family.name);
        setFamilyDescription(data.family.description || "");
        setRootOptions(data.rootOptions || []);
        setSelectedRootId(data.selectedRootId || "");
        setGenerationLimit(data.generationLimit || generationsToShow);
        setGenerations(data.generations || []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load family tree."
        );
        setGenerations([]);
      } finally {
        setLoading(false);
      }
    },
    [familyId, generationLimit]
  );

  React.useEffect(() => {
    void loadTree(undefined, 5);
    // loadTree intentionally initializes once for this family. Root and
    // generation changes call it explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  function changeRoot(nextRootId: string) {
    setSelectedRootId(nextRootId);
    void loadTree(nextRootId, generationLimit);
  }

  function changeGenerationLimit(nextLimit: number) {
    setGenerationLimit(nextLimit);
    void loadTree(selectedRootId, nextLimit);
  }

  const personNameById = React.useMemo(() => {
    const map = new Map<string, string>();

    for (const generation of generations) {
      for (const person of generation.people) {
        map.set(person.id, person.fullName);
      }
    }

    return map;
  }, [generations]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/admin/family-reunions/${familyId}`}
            className="text-sm font-bold text-amber-300"
          >
            Back to Family Project
          </Link>
          <span className="text-slate-700">/</span>
          <Link
            href="/admin/family-reunions"
            className="text-sm font-bold text-slate-400"
          >
            All Family Reunions
          </Link>
        </div>

        <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
              Family Tree
            </p>
            <h1 className="mt-2 text-3xl font-black">
              {familyName || "Family Tree"}
            </h1>
            {familyDescription ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                {familyDescription}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[560px]">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                Starting Ancestor
              </span>
              <select
                value={selectedRootId}
                onChange={(event) => changeRoot(event.target.value)}
                disabled={loading || rootOptions.length === 0}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white disabled:opacity-50"
              >
                {rootOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                    {person.suggestedRoot ? " - root candidate" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                Generations
              </span>
              <select
                value={generationLimit}
                onChange={(event) =>
                  changeGenerationLimit(Number(event.target.value))
                }
                disabled={loading}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white disabled:opacity-50"
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    Up to {count} generation{count === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm leading-6 text-slate-400">
          Generation numbers are calculated from the selected starting
          ancestor. They are not permanently stored on a person. Biological
          parent-child edges drive this view; spouse information appears only
          when an actual spouse record exists.
        </div>

        {loading ? (
          <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-8 text-sm text-slate-400">
            Loading family tree...
          </div>
        ) : error ? (
          <div className="mt-8 rounded-3xl border border-red-800 bg-red-950/40 p-6 text-sm text-red-200">
            {error}
          </div>
        ) : generations.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-amber-800 bg-amber-950/30 p-6">
            <p className="font-black text-amber-200">
              No descendants were found for this starting person.
            </p>
            <p className="mt-2 text-sm text-slate-400">
              You can still select another starting ancestor above.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-0">
            {generations.map((generation, generationIndex) => (
              <React.Fragment key={generation.generation}>
                {generationIndex > 0 ? (
                  <div className="mx-auto h-12 w-px bg-gradient-to-b from-amber-300/60 to-slate-700" />
                ) : null}

                <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                        Generation {generation.generation}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        {generation.people.length} person
                        {generation.people.length === 1 ? "" : "s"} at this
                        depth from the selected root.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {generation.people.map((person) => (
                      <article
                        key={person.id}
                        className="rounded-2xl border border-slate-700 bg-slate-950 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-black text-white">
                              {person.fullName}
                            </p>
                            {person.nickname ? (
                              <p className="mt-1 text-sm text-slate-400">
                                "{person.nickname}"
                              </p>
                            ) : null}
                          </div>

                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${
                              person.isLiving
                                ? "bg-emerald-400/10 text-emerald-300"
                                : "bg-slate-700 text-slate-300"
                            }`}
                          >
                            {person.isLiving ? "Living" : "Deceased"}
                          </span>
                        </div>

                        <p className="mt-3 text-sm text-slate-400">
                          {locationLabel(person)}
                        </p>

                        {person.parentIds.length > 0 ? (
                          <div className="mt-4 border-t border-slate-800 pt-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                              Parent
                              {person.parentIds.length > 1 ? "s" : ""}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-slate-300">
                              {person.parentIds
                                .map(
                                  (parentId) =>
                                    personNameById.get(parentId) ||
                                    "Recorded parent"
                                )
                                .join(", ")}
                            </p>
                          </div>
                        ) : null}

                        {person.spouses.length > 0 ? (
                          <div className="mt-3 border-t border-slate-800 pt-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                              Spouse
                              {person.spouses.length > 1 ? "s" : ""}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {person.spouses.map((spouse) => (
                                <span
                                  key={`${person.id}:${spouse.personId}`}
                                  className="rounded-full bg-rose-400/10 px-2.5 py-1 text-xs font-bold text-rose-200"
                                >
                                  {spouse.fullName} - {spouse.status}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
