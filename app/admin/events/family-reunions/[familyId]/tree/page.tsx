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
    locationText: string | null;
    locationBucket: string | null;
    isLiving: boolean;
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
  parentLinks?: TreeEdge[];
  outsideParents?: TreePerson[];
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
  showSpouses = true,
}: {
  person: TreePerson;
  nodeRef?: (element: HTMLDivElement | null) => void;
  compact?: boolean;
  showSpouses?: boolean;
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

      {showSpouses && person.spouses.length > 0 ? (
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

function CoupleCompanionCard({
  spouse,
}: {
  spouse: TreePerson["spouses"][number];
}) {
  const location =
    spouse.locationText && spouse.locationBucket
      ? spouse.locationText === spouse.locationBucket
        ? spouse.locationText
        : `${spouse.locationText} - ${spouse.locationBucket}`
      : spouse.locationText || spouse.locationBucket || "Location not recorded";

  return (
    <article className="w-[300px] rounded-2xl border border-rose-300/30 bg-slate-950 p-4 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 min-h-[2.5rem] font-black leading-5 text-white">
            {spouse.fullName}
          </p>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-rose-300">
            Spouse - {spouse.status}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${
            spouse.isLiving
              ? "bg-emerald-400/10 text-emerald-300"
              : "bg-slate-700 text-slate-300"
          }`}
        >
          {spouse.isLiving ? "Living" : "Deceased"}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-400">{location}</p>
    </article>
  );
}

function TreeDiagram({
  generations,
  parentLinks,
  outsideParents,
}: {
  generations: TreeGeneration[];
  parentLinks: TreeEdge[];
  outsideParents: TreePerson[];
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const rootNodeRef = React.useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [manualZoom, setManualZoom] = React.useState(false);

  // These anchors intentionally have different meanings:
  // - primaryRefs: the blood-line person's own card.
  // - spouseRefs: one rendered spouse card per primary/spouse pair.
  // - coupleAnchorRefs: one marriage/partnership marker per pair.
  //
  // Pair-specific keys are required for remarriage. Two spouses of the same
  // primary person must never overwrite each other's refs or share a child
  // connector anchor.
  const primaryRefs = React.useRef(new Map<string, HTMLDivElement>());
  const spouseRefs = React.useRef(new Map<string, HTMLDivElement>());
  const coupleAnchorRefs = React.useRef(new Map<string, HTMLDivElement>());

  const [connectors, setConnectors] = React.useState<Connector[]>([]);

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
    const map = new Map<string, TreePerson>();

    for (const generation of generations) {
      for (const person of generation.people) {
        map.set(person.id, person);
      }
    }

    return map;
  }, [generations]);

  const outsideParentById = React.useMemo(
    () => new Map(outsideParents.map((person) => [person.id, person] as const)),
    [outsideParents]
  );

  const supplementalParentsByChildId = React.useMemo(() => {
    const map = new Map<string, TreePerson[]>();

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
    const linksByChild = new Map<string, TreeEdge[]>();

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

    // getBoundingClientRect() returns already-scaled screen coordinates.
    // SVG path coordinates live inside the unscaled canvas and are scaled
    // once by the canvas transform. Divide relative screen coordinates by
    // zoom so connector positions are not scaled a second time.
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
      const startX =
        (sourceRect.left -
          containerRect.left +
          sourceRect.width / 2) /
        zoom;
      const startY =
        (sourceRect.bottom - containerRect.top) / zoom;

      const targetRect = target.getBoundingClientRect();

      // Incoming lineage always terminates at the selected blood-line
      // person's own card, never at the center of a couple unit.
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

  function setPrimaryRef(personId: string, element: HTMLDivElement | null) {
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

    const naturalWidth = Math.max(container.scrollWidth, container.offsetWidth);
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

      // offsetLeft is relative to the root card's nearest offset parent, not
      // the full scrollable tree canvas. Center by measuring the root's
      // current visual position inside the viewport, then applying only the
      // required scroll delta.
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
    const frame = window.requestAnimationFrame(() => {
      fitTree();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fitTree, generations, outsideParents]);

  React.useEffect(() => {
    if (manualZoom) return;

    const frame = window.requestAnimationFrame(() => {
      centerRoot("auto");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [centerRoot, manualZoom, zoom]);

  function changeZoom(delta: number) {
    setManualZoom(true);
    setZoom((current) =>
      Math.min(1.5, Math.max(0.35, Number((current + delta).toFixed(2))))
    );
  }

  return (
    <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6">
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

      <div
        ref={viewportRef}
        className="overflow-auto rounded-2xl"
      >
        <div
          style={{
            width: `${100 / zoom}%`,
          }}
        >
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
                            generation.units[0]?.primary.id === unit.primary.id
                          ) {
                            rootNodeRef.current = element;
                          }
                        }}
                      >
                        <PersonCard
                          person={unit.primary}
                          compact
                          showSpouses={false}
                        />
                      </div>

                      {(supplementalParentsByChildId.get(unit.primary.id) ?? []).map(
                        (parent) => (
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

                            <div className="w-[260px] rounded-xl border border-cyan-300/30 bg-slate-950 p-3 shadow-lg shadow-black/10">
                              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-cyan-300">
                                Other Biological Parent
                              </p>
                              <p className="mt-1 text-sm font-black text-white">
                                {parent.fullName}
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                {locationLabel(parent)}
                              </p>
                              <p className="mt-1 text-[10px] text-slate-500">
                                Outside selected descendant path
                              </p>
                            </div>
                          </React.Fragment>
                        )
                      )}
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
                                  <CoupleCompanionCard spouse={spouse} />
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
  generations: TreeGeneration[];
  outsideParents: TreePerson[];
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
                          .sort((a, b) => a.localeCompare(b, "en"))
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
  const [parentLinks, setParentLinks] = React.useState<TreeEdge[]>([]);
  const [outsideParents, setOutsideParents] = React.useState<TreePerson[]>([]);
  const [viewMode, setViewMode] = React.useState<ViewMode>("tree");

  const effectiveParentLinks =
    parentLinks.length > 0 ? parentLinks : edges;

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
          `/api/events/family-reunions/${encodeURIComponent(
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
          setParentLinks([]);
          setOutsideParents([]);
          return;
        }

        setFamilyName(data.family.name);
        setFamilyDescription(data.family.description || "");
        setRootOptions(data.rootOptions || []);
        setSelectedRootId(data.selectedRootId || "");
        setGenerationLimit(data.generationLimit || generationsToShow);
        setGenerations(data.generations || []);
        setEdges(data.edges || []);
        setParentLinks(data.parentLinks || []);
        setOutsideParents(data.outsideParents || []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load family tree."
        );
        setGenerations([]);
        setEdges([]);
        setParentLinks([]);
        setOutsideParents([]);
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
            href={`/admin/events/family-reunions/${familyId}`}
            className="text-sm font-bold text-amber-300"
          >
            Back to Family Project
          </Link>
          <span className="text-slate-700">/</span>
          <Link
            href="/admin/events/family-reunions"
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
          <TreeDiagram
            generations={generations}
            parentLinks={effectiveParentLinks}
            outsideParents={outsideParents}
          />
        ) : (
          <ListView
            generations={generations}
            outsideParents={outsideParents}
          />
        )}
      </div>
    </main>
  );
}
