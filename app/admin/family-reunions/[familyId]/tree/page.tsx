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

type TreeEdge = {
  parentPersonId: string;
  childPersonId: string;
  relationshipType: string;
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
  edges?: TreeEdge[];
};

type ViewMode = "tree" | "list";

type Connector = {
  key: string;
  d: string;
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

function PersonCard({
  person,
  nodeRef,
  compact = false,
}: {
  person: TreePerson;
  nodeRef?: (element: HTMLDivElement | null) => void;
  compact?: boolean;
}) {
  return (
    <article
      ref={nodeRef}
      data-person-id={person.id}
      className={`rounded-2xl border border-slate-700 bg-slate-950 shadow-lg shadow-black/10 ${
        compact ? "w-[300px] p-4" : "p-4"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 min-h-[2.5rem] font-black leading-5 text-white">{person.fullName}</p>
          {person.nickname ? (
            <p className="mt-1 line-clamp-2 text-sm text-slate-400">
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

      <p className="mt-3 text-sm text-slate-400">{locationLabel(person)}</p>

      {person.spouses.length > 0 ? (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
            Spouse{person.spouses.length > 1 ? "s" : ""}
          </p>
          <div className="mt-2 space-y-2">
            {person.spouses.map((spouse) => (
              <div
                key={`${person.id}:${spouse.personId}`}
                className="flex items-center gap-2"
              >
                <span className="h-px w-5 shrink-0 bg-rose-300/70" />
                <span className="rounded-full bg-rose-400/10 px-2.5 py-1 text-xs font-bold text-rose-200">
                  {spouse.fullName} - {spouse.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function TreeDiagram({
  generations,
  edges,
}: {
  generations: TreeGeneration[];
  edges: TreeEdge[];
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const nodeRefs = React.useRef(new Map<string, HTMLDivElement>());
  const [connectors, setConnectors] = React.useState<Connector[]>([]);

  const visibleIds = React.useMemo(() => {
    return new Set(
      generations.flatMap((generation) =>
        generation.people.map((person) => person.id)
      )
    );
  }, [generations]);

  const visibleEdges = React.useMemo(
    () =>
      edges.filter(
        (edge) =>
          visibleIds.has(edge.parentPersonId) &&
          visibleIds.has(edge.childPersonId)
      ),
    [edges, visibleIds]
  );

  const calculateConnectors = React.useCallback(() => {
    const container = containerRef.current;

    if (!container) {
      setConnectors([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const next: Connector[] = [];

    for (const edge of visibleEdges) {
      const parent = nodeRefs.current.get(edge.parentPersonId);
      const child = nodeRefs.current.get(edge.childPersonId);

      if (!parent || !child) continue;

      const parentRect = parent.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();

      const startX =
        parentRect.left - containerRect.left + parentRect.width / 2;
      const startY = parentRect.bottom - containerRect.top;
      const endX = childRect.left - containerRect.left + childRect.width / 2;
      const endY = childRect.top - containerRect.top;
      const midY = startY + (endY - startY) / 2;

      next.push({
        key: `${edge.parentPersonId}:${edge.childPersonId}`,
        d: `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`,
      });
    }

    setConnectors(next);
  }, [visibleEdges]);

  React.useLayoutEffect(() => {
    calculateConnectors();

    const container = containerRef.current;

    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      calculateConnectors();
    });

    observer.observe(container);

    for (const element of nodeRefs.current.values()) {
      observer.observe(element);
    }

    window.addEventListener("resize", calculateConnectors);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", calculateConnectors);
    };
  }, [calculateConnectors, generations]);

  function setNodeRef(personId: string, element: HTMLDivElement | null) {
    if (element) {
      nodeRefs.current.set(personId, element);
    } else {
      nodeRefs.current.delete(personId);
    }
  }

  return (
    <div className="mt-8 overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6">
      <div
        ref={containerRef}
        className="relative min-w-[980px] pb-4"
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          {connectors.map((connector) => (
            <path
              key={connector.key}
              d={connector.d}
              fill="none"
              stroke="rgba(251, 191, 36, 0.55)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>

        <div className="relative z-10 space-y-20">
          {generations.map((generation) => (
            <section key={generation.generation}>
              <div className="mb-4 text-center">
                <span className="inline-flex rounded-full border border-amber-300/30 bg-slate-950 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
                  Generation {generation.generation}
                </span>
              </div>

              <div className="flex justify-center gap-14 px-8">
                {generation.people.map((person) => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    compact
                    nodeRef={(element) => setNodeRef(person.id, element)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function ListView({
  generations,
}: {
  generations: TreeGeneration[];
}) {
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
                  {generation.people.length === 1 ? "" : "s"} at this depth
                  from the selected root.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {generation.people.map((person) => (
                <div key={person.id}>
                  <PersonCard person={person} />

                  {person.parentIds.length > 0 ? (
                    <div className="-mt-3 rounded-b-2xl border border-t-0 border-slate-700 bg-slate-950 px-4 pb-4 pt-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                        Parent{person.parentIds.length > 1 ? "s" : ""}
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
                </div>
              ))}
            </div>
          </section>
        </React.Fragment>
      ))}
    </div>
  );
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
  const [edges, setEdges] = React.useState<TreeEdge[]>([]);
  const [viewMode, setViewMode] = React.useState<ViewMode>("tree");

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
          setEdges([]);
          return;
        }

        setFamilyName(data.family.name);
        setFamilyDescription(data.family.description || "");
        setRootOptions(data.rootOptions || []);
        setSelectedRootId(data.selectedRootId || "");
        setGenerationLimit(data.generationLimit || generationsToShow);
        setGenerations(data.generations || []);
        setEdges(data.edges || []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load family tree."
        );
        setGenerations([]);
        setEdges([]);
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

        <div className="mt-6 flex flex-col gap-6 2xl:flex-row 2xl:items-end 2xl:justify-between">
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

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:min-w-[860px]">
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

            <div>
              <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                View
              </span>
              <div className="mt-2 grid grid-cols-2 rounded-xl border border-slate-700 bg-slate-900 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode("tree")}
                  className={`rounded-lg px-3 py-2 text-sm font-black ${
                    viewMode === "tree"
                      ? "bg-amber-400 text-slate-950"
                      : "text-slate-300"
                  }`}
                >
                  Tree View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`rounded-lg px-3 py-2 text-sm font-black ${
                    viewMode === "list"
                      ? "bg-amber-400 text-slate-950"
                      : "text-slate-300"
                  }`}
                >
                  List View
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm leading-6 text-slate-400">
          Generation numbers are calculated from the selected starting
          ancestor. Biological parent-child edges drive this view. Spouse
          labels appear only when an actual spouse record exists.
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
        ) : viewMode === "tree" ? (
          <TreeDiagram generations={generations} edges={edges} />
        ) : (
          <ListView generations={generations} />
        )}
      </div>
    </main>
  );
}
