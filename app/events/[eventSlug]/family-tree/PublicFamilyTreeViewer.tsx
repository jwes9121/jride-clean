"use client";

import * as React from "react";

export type PublicTreeSpouse = {
  personId: string;
  fullName: string;
};

export type PublicTreePerson = {
  id: string;
  fullName: string;
  parentIds: string[];
  spouses: PublicTreeSpouse[];
};

export type PublicTreeGeneration = {
  generation: number;
  people: PublicTreePerson[];
};

export type PublicTreeEdge = {
  parentPersonId: string;
  childPersonId: string;
  relationshipType: string;
};

type ViewMode = "tree" | "list";

type Connector = {
  key: string;
  d: string;
};

function spousePairIdentity(personAId: string, personBId: string) {
  return [personAId, personBId].sort().join("::");
}

function spouseRenderKey(primaryPersonId: string, spousePersonId: string) {
  return `${primaryPersonId}::spouse::${spousePersonId}`;
}

function PersonCard({
  person,
  compact = false,
}: {
  person: PublicTreePerson;
  compact?: boolean;
}) {
  return (
    <article
      data-person-id={person.id}
      className={`rounded-2xl border border-slate-700 bg-slate-950 shadow-lg shadow-black/10 ${
        compact ? "w-[260px] p-4" : "p-4"
      }`}
    >
      <p className="line-clamp-2 min-h-[2.5rem] font-black leading-5 text-white">
        {person.fullName}
      </p>
    </article>
  );
}

function SpouseCard({ spouse }: { spouse: PublicTreeSpouse }) {
  return (
    <article className="w-[260px] rounded-2xl border border-rose-300/30 bg-slate-950 p-4 shadow-lg shadow-black/10">
      <p className="line-clamp-2 min-h-[2.5rem] font-black leading-5 text-white">
        {spouse.fullName}
      </p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-rose-300">
        Spouse / Partner
      </p>
    </article>
  );
}

function TreeDiagram({
  generations,
  parentLinks,
  outsideParents,
}: {
  generations: PublicTreeGeneration[];
  parentLinks: PublicTreeEdge[];
  outsideParents: PublicTreePerson[];
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const rootNodeRef = React.useRef<HTMLDivElement | null>(null);
  const primaryRefs = React.useRef(new Map<string, HTMLDivElement>());
  const spouseRefs = React.useRef(new Map<string, HTMLDivElement>());
  const coupleAnchorRefs = React.useRef(new Map<string, HTMLDivElement>());
  const [connectors, setConnectors] = React.useState<Connector[]>([]);
  const [zoom, setZoom] = React.useState(1);
  const [manualZoom, setManualZoom] = React.useState(false);

  const units = React.useMemo(
    () =>
      generations.map((generation) => ({
        generation: generation.generation,
        units: generation.people.map((person) => ({
          key: person.id,
          primary: person,
          spouses: person.spouses,
        })),
      })),
    [generations]
  );

  const visiblePeopleById = React.useMemo(() => {
    const map = new Map<string, PublicTreePerson>();

    for (const generation of generations) {
      for (const person of generation.people) {
        map.set(person.id, person);
      }
    }

    return map;
  }, [generations]);

  const outsideParentById = React.useMemo(
    () =>
      new Map(
        outsideParents.map((person) => [person.id, person] as const)
      ),
    [outsideParents]
  );

  const supplementalParentsByChildId = React.useMemo(() => {
    const map = new Map<string, PublicTreePerson[]>();

    for (const link of parentLinks) {
      if (!visiblePeopleById.has(link.childPersonId)) continue;

      const parent = outsideParentById.get(link.parentPersonId);
      if (!parent) continue;

      const child = visiblePeopleById.get(link.childPersonId);
      const representedAsSpouse = child
        ? child.parentIds.some((parentId) => {
            const visibleParent = visiblePeopleById.get(parentId);
            return visibleParent?.spouses.some(
              (spouse) => spouse.personId === parent.id
            );
          })
        : false;

      if (representedAsSpouse) continue;

      const existing = map.get(link.childPersonId) ?? [];
      if (!existing.some((person) => person.id === parent.id)) {
        existing.push(parent);
      }
      map.set(link.childPersonId, existing);
    }

    return map;
  }, [outsideParentById, parentLinks, visiblePeopleById]);

  const spousePairRenderKeyByIdentity = React.useMemo(() => {
    const map = new Map<string, string>();

    for (const generation of units) {
      for (const unit of generation.units) {
        for (const spouse of unit.spouses) {
          map.set(
            spousePairIdentity(unit.primary.id, spouse.personId),
            spouseRenderKey(unit.primary.id, spouse.personId)
          );
        }
      }
    }

    return map;
  }, [units]);

  const spouseRenderKeysByPersonId = React.useMemo(() => {
    const map = new Map<string, string[]>();

    for (const generation of units) {
      for (const unit of generation.units) {
        for (const spouse of unit.spouses) {
          const renderKey = spouseRenderKey(
            unit.primary.id,
            spouse.personId
          );
          const existing = map.get(spouse.personId) ?? [];
          existing.push(renderKey);
          map.set(spouse.personId, existing);
        }
      }
    }

    return map;
  }, [units]);

  const connectorPlans = React.useMemo(() => {
    const linksByChild = new Map<string, PublicTreeEdge[]>();

    for (const link of parentLinks) {
      if (!visiblePeopleById.has(link.childPersonId)) continue;
      const existing = linksByChild.get(link.childPersonId) ?? [];
      existing.push(link);
      linksByChild.set(link.childPersonId, existing);
    }

    const plans: {
      key: string;
      sourceKind: "primary" | "spouse" | "couple";
      sourceKey: string;
      targetPersonId: string;
    }[] = [];

    function addSingleParentPlan(
      parentPersonId: string,
      childPersonId: string
    ) {
      if (visiblePeopleById.has(parentPersonId)) {
        plans.push({
          key: `${parentPersonId}:${childPersonId}`,
          sourceKind: "primary",
          sourceKey: parentPersonId,
          targetPersonId: childPersonId,
        });
        return;
      }

      const spouseRenderKeys =
        spouseRenderKeysByPersonId.get(parentPersonId) ?? [];

      if (spouseRenderKeys.length > 0) {
        plans.push({
          key: `${parentPersonId}:${childPersonId}`,
          sourceKind: "spouse",
          sourceKey: spouseRenderKeys[0],
          targetPersonId: childPersonId,
        });
      }
    }

    for (const [childPersonId, childLinks] of linksByChild.entries()) {
      const parentPersonIds = Array.from(
        new Set(childLinks.map((link) => link.parentPersonId))
      );

      if (parentPersonIds.length === 2) {
        const pairIdentity = spousePairIdentity(
          parentPersonIds[0],
          parentPersonIds[1]
        );
        const pairRenderKey =
          spousePairRenderKeyByIdentity.get(pairIdentity);

        if (pairRenderKey) {
          plans.push({
            key: `${pairRenderKey}:${childPersonId}`,
            sourceKind: "couple",
            sourceKey: pairRenderKey,
            targetPersonId: childPersonId,
          });
          continue;
        }
      }

      for (const parentPersonId of parentPersonIds) {
        addSingleParentPlan(parentPersonId, childPersonId);
      }
    }

    return plans;
  }, [
    parentLinks,
    spousePairRenderKeyByIdentity,
    spouseRenderKeysByPersonId,
    visiblePeopleById,
  ]);

  const calculateConnectors = React.useCallback(() => {
    const container = containerRef.current;

    if (!container) {
      setConnectors([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const next: Connector[] = [];

    for (const plan of connectorPlans) {
      const target = primaryRefs.current.get(plan.targetPersonId);
      if (!target) continue;

      let source: HTMLDivElement | undefined;

      if (plan.sourceKind === "couple") {
        source = coupleAnchorRefs.current.get(plan.sourceKey);
      } else if (plan.sourceKind === "spouse") {
        source = spouseRefs.current.get(plan.sourceKey);
      } else {
        source = primaryRefs.current.get(plan.sourceKey);
      }

      if (!source) continue;

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();

      const startX =
        (sourceRect.left -
          containerRect.left +
          sourceRect.width / 2) /
        zoom;
      const startY =
        (sourceRect.bottom - containerRect.top) / zoom;
      const endX =
        (targetRect.left -
          containerRect.left +
          targetRect.width / 2) /
        zoom;
      const endY =
        (targetRect.top - containerRect.top) / zoom;
      const midY = startY + (endY - startY) / 2;

      next.push({
        key: plan.key,
        d: `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`,
      });
    }

    setConnectors(next);
  }, [connectorPlans, zoom]);

  React.useLayoutEffect(() => {
    calculateConnectors();

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(calculateConnectors);
    observer.observe(container);

    for (const element of primaryRefs.current.values()) {
      observer.observe(element);
    }
    for (const element of coupleAnchorRefs.current.values()) {
      observer.observe(element);
    }
    for (const element of spouseRefs.current.values()) {
      observer.observe(element);
    }

    window.addEventListener("resize", calculateConnectors);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", calculateConnectors);
    };
  }, [calculateConnectors, units]);

  function setPrimaryRef(
    personId: string,
    element: HTMLDivElement | null
  ) {
    if (element) {
      primaryRefs.current.set(personId, element);
    } else {
      primaryRefs.current.delete(personId);
    }
  }

  function setCoupleAnchorRef(
    pairRenderKey: string,
    element: HTMLDivElement | null
  ) {
    if (element) {
      coupleAnchorRefs.current.set(pairRenderKey, element);
    } else {
      coupleAnchorRefs.current.delete(pairRenderKey);
    }
  }

  function setSpouseRef(
    pairRenderKey: string,
    element: HTMLDivElement | null
  ) {
    if (element) {
      spouseRefs.current.set(pairRenderKey, element);
    } else {
      spouseRefs.current.delete(pairRenderKey);
    }
  }

  const fitTree = React.useCallback(() => {
    const viewport = viewportRef.current;
    const container = containerRef.current;

    if (!viewport || !container) return;

    const naturalWidth = Math.max(
      container.scrollWidth,
      container.offsetWidth
    );
    const availableWidth = Math.max(320, viewport.clientWidth - 24);

    if (naturalWidth <= 0) return;

    const nextZoom = Math.min(
      1,
      Math.max(0.35, availableWidth / naturalWidth)
    );

    setZoom(nextZoom);
    setManualZoom(false);
  }, []);

  const centerRoot = React.useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const viewport = viewportRef.current;
      const root = rootNodeRef.current;

      if (!viewport || !root) return;

      const viewportRect = viewport.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const rootCenterX = rootRect.left + rootRect.width / 2;
      const viewportCenterX =
        viewportRect.left + viewport.clientWidth / 2;
      const deltaX = rootCenterX - viewportCenterX;
      const maxScrollLeft = Math.max(
        0,
        viewport.scrollWidth - viewport.clientWidth
      );
      const targetScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, viewport.scrollLeft + deltaX)
      );

      viewport.scrollTo({
        left: targetScrollLeft,
        behavior,
      });
    },
    []
  );

  React.useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => fitTree());
    return () => window.cancelAnimationFrame(frame);
  }, [fitTree, generations, outsideParents]);

  React.useEffect(() => {
    if (manualZoom) return;
    const frame = window.requestAnimationFrame(() =>
      centerRoot("auto")
    );
    return () => window.cancelAnimationFrame(frame);
  }, [centerRoot, manualZoom, zoom]);

  function changeZoom(delta: number) {
    setManualZoom(true);
    setZoom((current) =>
      Math.min(
        1.5,
        Math.max(0.35, Number((current + delta).toFixed(2)))
      )
    );
  }

  return (
    <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => changeZoom(-0.1)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-black text-slate-300"
        >
          -
        </button>

        <button
          type="button"
          onClick={fitTree}
          className="rounded-lg border border-amber-300/40 bg-slate-950 px-3 py-2 text-xs font-black text-amber-300"
        >
          Fit Tree
        </button>

        <span className="min-w-[58px] text-center text-xs font-black text-slate-300">
          {Math.round(zoom * 100)}%
        </span>

        <button
          type="button"
          onClick={() => changeZoom(0.1)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-black text-slate-300"
        >
          +
        </button>

        <button
          type="button"
          onClick={() => centerRoot()}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-black text-slate-300"
        >
          Center Root
        </button>
      </div>

      <div ref={viewportRef} className="overflow-auto rounded-2xl">
        <div style={{ width: `${100 / zoom}%` }}>
          <div
            ref={containerRef}
            className="relative w-max min-w-full pb-4"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
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
              {units.map((generation) => (
                <section key={generation.generation}>
                  <div className="mb-4 text-center">
                    <span className="inline-flex rounded-full border border-amber-300/30 bg-slate-950 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
                      Generation {generation.generation}
                    </span>
                  </div>

                  <div className="mx-auto flex w-max min-w-full justify-center gap-16 px-8">
                    {generation.units.map((unit) => (
                      <div
                        key={unit.key}
                        className="flex items-center justify-center"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            ref={(element) => {
                              setPrimaryRef(unit.primary.id, element);

                              if (
                                generation.generation === 1 &&
                                generation.units[0]?.primary.id ===
                                  unit.primary.id
                              ) {
                                rootNodeRef.current = element;
                              }
                            }}
                          >
                            <PersonCard person={unit.primary} compact />
                          </div>

                          {(
                            supplementalParentsByChildId.get(
                              unit.primary.id
                            ) ?? []
                          ).map((parent) => (
                            <React.Fragment
                              key={`${unit.primary.id}:outside-parent:${parent.id}`}
                            >
                              <div
                                className="flex h-8 items-center gap-1"
                                aria-hidden="true"
                              >
                                <span className="h-px w-5 bg-cyan-300/70" />
                                <span className="text-[10px] font-black text-cyan-300">
                                  +
                                </span>
                                <span className="h-px w-5 bg-cyan-300/70" />
                              </div>

                              <div className="w-[230px] rounded-xl border border-cyan-300/30 bg-slate-950 p-3 shadow-lg shadow-black/10">
                                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-cyan-300">
                                  Other Biological Parent
                                </p>
                                <p className="mt-1 text-sm font-black text-white">
                                  {parent.fullName}
                                </p>
                              </div>
                            </React.Fragment>
                          ))}
                        </div>

                        {unit.spouses.length > 0 ? (
                          <div className="relative ml-3 flex items-center pl-8">
                            {unit.spouses.length > 1 ? (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="absolute left-0 top-1/2 h-px w-4 bg-rose-300/70"
                                />
                                <span
                                  aria-hidden="true"
                                  className="absolute bottom-8 left-4 top-8 w-px bg-rose-300/50"
                                />
                              </>
                            ) : null}

                            <div className="flex flex-col gap-4">
                              {unit.spouses.map((spouse) => {
                                const pairRenderKey = spouseRenderKey(
                                  unit.primary.id,
                                  spouse.personId
                                );

                                return (
                                  <div
                                    key={pairRenderKey}
                                    className="relative flex items-center"
                                  >
                                    {unit.spouses.length > 1 ? (
                                      <span
                                        aria-hidden="true"
                                        className="absolute -left-4 h-px w-4 bg-rose-300/50"
                                      />
                                    ) : null}

                                    <div
                                      ref={(element) =>
                                        setCoupleAnchorRef(
                                          pairRenderKey,
                                          element
                                        )
                                      }
                                      className="mr-3 flex h-8 items-center gap-1"
                                      aria-label={`${unit.primary.fullName} and ${spouse.fullName} spouse connection`}
                                    >
                                      <span className="h-px w-8 bg-rose-300/80" />
                                      <span className="text-xs font-black text-rose-300">
                                        =
                                      </span>
                                      <span className="h-px w-8 bg-rose-300/80" />
                                    </div>

                                    <div
                                      ref={(element) =>
                                        setSpouseRef(
                                          pairRenderKey,
                                          element
                                        )
                                      }
                                    >
                                      <SpouseCard spouse={spouse} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListView({
  generations,
  outsideParents,
}: {
  generations: PublicTreeGeneration[];
  outsideParents: PublicTreePerson[];
}) {
  const personNameById = React.useMemo(() => {
    const map = new Map<string, string>();

    for (const generation of generations) {
      for (const person of generation.people) {
        map.set(person.id, person.fullName);
      }
    }

    for (const person of outsideParents) {
      map.set(person.id, person.fullName);
    }

    return map;
  }, [generations, outsideParents]);

  return (
    <div className="mt-6 space-y-0">
      {generations.map((generation, generationIndex) => (
        <React.Fragment key={generation.generation}>
          {generationIndex > 0 ? (
            <div className="mx-auto h-10 w-px bg-gradient-to-b from-amber-300/60 to-slate-700" />
          ) : null}

          <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-black text-white">
                Generation {generation.generation}
              </h2>
              <span className="text-xs font-bold text-slate-500">
                {generation.people.length} person
                {generation.people.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {generation.people.map((person) => {
                const parentNames = person.parentIds
                  .map((parentId) => personNameById.get(parentId))
                  .filter((name): name is string => Boolean(name))
                  .sort((a, b) => a.localeCompare(b, "en"));

                return (
                  <div
                    key={person.id}
                    className="rounded-2xl border border-slate-700 bg-slate-950 p-4"
                  >
                    <p className="font-black text-white">
                      {person.fullName}
                    </p>

                    {parentNames.length > 0 ? (
                      <p className="mt-2 text-xs leading-5 text-slate-400">
                        Biological parent
                        {parentNames.length === 1 ? "" : "s"}:{" "}
                        {parentNames.join(", ")}
                      </p>
                    ) : null}

                    {person.spouses.length > 0 ? (
                      <p className="mt-2 text-xs leading-5 text-rose-200">
                        Spouse / partner
                        {person.spouses.length === 1 ? "" : "s"}:{" "}
                        {person.spouses
                          .map((spouse) => spouse.fullName)
                          .sort((a, b) => a.localeCompare(b, "en"))
                          .join(", ")}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function PublicFamilyTreeViewer({
  generations,
  parentLinks,
  outsideParents,
}: {
  generations: PublicTreeGeneration[];
  parentLinks: PublicTreeEdge[];
  outsideParents: PublicTreePerson[];
}) {
  const [viewMode, setViewMode] = React.useState<ViewMode>("tree");

  return (
    <>
      <div className="mt-5 flex justify-end">
        <div className="grid grid-cols-2 rounded-xl border border-slate-700 bg-slate-900 p-1">
          <button
            type="button"
            onClick={() => setViewMode("tree")}
            className={`rounded-lg px-4 py-2 text-sm font-black ${
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
            className={`rounded-lg px-4 py-2 text-sm font-black ${
              viewMode === "list"
                ? "bg-amber-400 text-slate-950"
                : "text-slate-300"
            }`}
          >
            List View
          </button>
        </div>
      </div>

      {viewMode === "tree" ? (
        <TreeDiagram
          generations={generations}
          parentLinks={parentLinks}
          outsideParents={outsideParents}
        />
      ) : (
        <ListView
          generations={generations}
          outsideParents={outsideParents}
        />
      )}
    </>
  );
}
