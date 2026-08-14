import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import PublicFamilyTreeViewer, {
  type PublicTreeEdge,
  type PublicTreeGeneration,
  type PublicTreePerson,
} from "./PublicFamilyTreeViewer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PUBLIC_EVENT_STATUSES = [
  "published",
  "registration_open",
  "registration_closed",
  "live",
  "completed",
];

type PersonRow = {
  id: string;
  full_name: string;
};

type ParentChildRow = {
  parent_person_id: string;
  child_person_id: string;
  relationship_type: string;
};

type SpouseRow = {
  person_a_id: string;
  person_b_id: string;
};

async function loadPeopleByIds(
  supabase: ReturnType<typeof supabaseAdmin>,
  ids: string[]
) {
  if (ids.length === 0) {
    return [] as PersonRow[];
  }

  const { data, error } = await supabase
    .from("family_people")
    .select("id,full_name")
    .in("id", ids);

  if (error) throw new Error(error.message);

  return (data ?? []) as PersonRow[];
}

function unavailablePage(
  eventSlug: string,
  eventName: string,
  message: string
) {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <Link
          href={`/events/${eventSlug}`}
          className="text-sm font-bold text-amber-300"
        >
          Back to Event
        </Link>

        <div className="mt-8 rounded-3xl border border-amber-800 bg-amber-950/20 p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
            Family Tree
          </p>
          <h1 className="mt-2 text-3xl font-black">{eventName}</h1>
          <p className="mt-4 text-sm leading-6 text-amber-100/80">
            {message}
          </p>
        </div>
      </div>
    </main>
  );
}

export default async function PublicEventFamilyTreePage({
  params,
}: {
  params: { eventSlug: string };
}) {
  const supabase = supabaseAdmin();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id,slug,name,status")
    .eq("slug", params.eventSlug)
    .in("status", PUBLIC_EVENT_STATUSES)
    .maybeSingle();

  if (eventError) throw new Error(eventError.message);
  if (!event?.id) notFound();

  const { data: familyLink, error: familyLinkError } = await supabase
    .from("family_reunion_events")
    .select("family_id")
    .eq("event_id", event.id)
    .maybeSingle();

  if (familyLinkError) throw new Error(familyLinkError.message);
  if (!familyLink?.family_id) notFound();

  const { data: family, error: familyError } = await supabase
    .from("families")
    .select("id,name,description,display_root_person_id")
    .eq("id", familyLink.family_id)
    .maybeSingle();

  if (familyError) throw new Error(familyError.message);
  if (!family?.id) notFound();

  const rootPersonId = String(family.display_root_person_id || "").trim();

  if (!rootPersonId) {
    return unavailablePage(
      event.slug,
      event.name,
      "The organizer has not configured the public family-tree root yet."
    );
  }

  const { data: rootPerson, error: rootPersonError } = await supabase
    .from("family_people")
    .select("id,full_name")
    .eq("id", rootPersonId)
    .maybeSingle();

  if (rootPersonError) throw new Error(rootPersonError.message);

  if (!rootPerson?.id) {
    return unavailablePage(
      event.slug,
      event.name,
      "The configured family-tree root is no longer available."
    );
  }

  const generationByPersonId = new Map<string, number>();
  generationByPersonId.set(rootPersonId, 1);

  let frontier = [rootPersonId];

  for (
    let generation = 1;
    generation < 5 && frontier.length > 0;
    generation += 1
  ) {
    const { data: edgeRows, error: edgeError } = await supabase
      .from("family_parent_child")
      .select("parent_person_id,child_person_id,relationship_type")
      .in("parent_person_id", frontier)
      .eq("relationship_type", "biological");

    if (edgeError) throw new Error(edgeError.message);

    const edges = (edgeRows ?? []) as ParentChildRow[];
    const nextFrontier: string[] = [];

    for (const edge of edges) {
      const nextGeneration = generation + 1;
      const knownGeneration = generationByPersonId.get(
        edge.child_person_id
      );

      if (
        knownGeneration === undefined ||
        nextGeneration < knownGeneration
      ) {
        generationByPersonId.set(
          edge.child_person_id,
          nextGeneration
        );
        nextFrontier.push(edge.child_person_id);
      } else if (
        nextGeneration === knownGeneration &&
        !nextFrontier.includes(edge.child_person_id)
      ) {
        nextFrontier.push(edge.child_person_id);
      }
    }

    frontier = Array.from(new Set(nextFrontier));
  }

  const visiblePersonIds = Array.from(generationByPersonId.keys());
  const visiblePeople = await loadPeopleByIds(
    supabase,
    visiblePersonIds
  );

  if (visiblePeople.length === 0) {
    return unavailablePage(
      event.slug,
      event.name,
      "No family-tree people are available from the configured root."
    );
  }

  const visiblePeopleById = new Map(
    visiblePeople.map((person) => [person.id, person] as const)
  );

  const {
    data: completeParentRows,
    error: completeParentRowsError,
  } = await supabase
    .from("family_parent_child")
    .select("parent_person_id,child_person_id,relationship_type")
    .in("child_person_id", visiblePersonIds)
    .eq("relationship_type", "biological");

  if (completeParentRowsError) {
    throw new Error(completeParentRowsError.message);
  }

  const completeParents =
    (completeParentRows ?? []) as ParentChildRow[];

  const outsideParentIds = Array.from(
    new Set(
      completeParents
        .map((edge) => edge.parent_person_id)
        .filter((id) => !visiblePeopleById.has(id))
    )
  );

  const outsideParentRows = await loadPeopleByIds(
    supabase,
    outsideParentIds
  );

  const spouseRowsByPair = new Map<string, SpouseRow>();

  if (visiblePersonIds.length > 0) {
    const [
      { data: spouseA, error: spouseAError },
      { data: spouseB, error: spouseBError },
    ] = await Promise.all([
      supabase
        .from("family_spouses")
        .select("person_a_id,person_b_id")
        .in("person_a_id", visiblePersonIds),
      supabase
        .from("family_spouses")
        .select("person_a_id,person_b_id")
        .in("person_b_id", visiblePersonIds),
    ]);

    if (spouseAError) throw new Error(spouseAError.message);
    if (spouseBError) throw new Error(spouseBError.message);

    for (const row of [
      ...((spouseA ?? []) as SpouseRow[]),
      ...((spouseB ?? []) as SpouseRow[]),
    ]) {
      const key = [row.person_a_id, row.person_b_id]
        .sort()
        .join(":");
      spouseRowsByPair.set(key, row);
    }
  }

  const spouseRows = Array.from(spouseRowsByPair.values());

  const spousePersonIds = Array.from(
    new Set(
      spouseRows.flatMap((row) => [
        row.person_a_id,
        row.person_b_id,
      ])
    )
  ).filter((id) => !visiblePeopleById.has(id));

  const spouseOnlyPeople = await loadPeopleByIds(
    supabase,
    spousePersonIds
  );

  const allPeopleById = new Map(
    [...visiblePeople, ...spouseOnlyPeople].map(
      (person) => [person.id, person] as const
    )
  );

  const parentIdsByChildId = new Map<string, string[]>();

  for (const edge of completeParents) {
    const existing =
      parentIdsByChildId.get(edge.child_person_id) ?? [];

    if (!existing.includes(edge.parent_person_id)) {
      existing.push(edge.parent_person_id);
    }

    parentIdsByChildId.set(edge.child_person_id, existing);
  }

  const spouseSummariesByPersonId = new Map<
    string,
    { personId: string; fullName: string }[]
  >();

  for (const spouse of spouseRows) {
    const personA = allPeopleById.get(spouse.person_a_id);
    const personB = allPeopleById.get(spouse.person_b_id);

    if (!personA || !personB) continue;

    const aList = spouseSummariesByPersonId.get(personA.id) ?? [];
    aList.push({
      personId: personB.id,
      fullName: personB.full_name,
    });
    spouseSummariesByPersonId.set(personA.id, aList);

    const bList = spouseSummariesByPersonId.get(personB.id) ?? [];
    bList.push({
      personId: personA.id,
      fullName: personA.full_name,
    });
    spouseSummariesByPersonId.set(personB.id, bList);
  }

  const generations: PublicTreeGeneration[] = Array.from(
    { length: 5 },
    (_, index) => index + 1
  )
    .map((generation) => ({
      generation,
      people: visiblePeople
        .filter(
          (person) =>
            generationByPersonId.get(person.id) === generation
        )
        .sort((a, b) =>
          a.full_name.localeCompare(b.full_name, "en")
        )
        .map(
          (person): PublicTreePerson => ({
            id: person.id,
            fullName: person.full_name,
            parentIds:
              parentIdsByChildId.get(person.id) ?? [],
            spouses:
              spouseSummariesByPersonId.get(person.id) ?? [],
          })
        ),
    }))
    .filter((group) => group.people.length > 0);

  const parentLinks: PublicTreeEdge[] = completeParents.map(
    (edge) => ({
      parentPersonId: edge.parent_person_id,
      childPersonId: edge.child_person_id,
      relationshipType: edge.relationship_type,
    })
  );

  const outsideParents: PublicTreePerson[] =
    outsideParentRows.map((person) => ({
      id: person.id,
      fullName: person.full_name,
      parentIds: [],
      spouses: [],
    }));

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <Link
          href={`/events/${event.slug}`}
          className="text-sm font-bold text-amber-300"
        >
          Back to Event
        </Link>

        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">
              Family Tree
            </p>
            <h1 className="mt-2 text-3xl font-black">
              {family.name}
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              {event.name}
            </p>
            {family.description ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                {family.description}
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              Starting Ancestor
            </p>
            <p className="mt-1 font-black text-white">
              {rootPerson.full_name}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Up to 5 generations
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm leading-6 text-slate-400">
          This is a read-only public family-tree view. It shows names and
          relationship structure only. Detailed personal information and
          genealogy editing tools are not published here.
        </div>

        <PublicFamilyTreeViewer
          generations={generations}
          parentLinks={parentLinks}
          outsideParents={outsideParents}
        />
      </div>
    </main>
  );
}
