import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_TREE_GENERATIONS = 5;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function cleanUuid(value: unknown) {
  const text = String(value || "").trim().toLowerCase();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    text
  )
    ? text
    : "";
}

function cleanGenerationLimit(value: string | null) {
  const parsed = Number(value || MAX_TREE_GENERATIONS);

  if (!Number.isInteger(parsed)) {
    return MAX_TREE_GENERATIONS;
  }

  return Math.min(MAX_TREE_GENERATIONS, Math.max(1, parsed));
}

type PersonRow = {
  id: string;
  family_id: string | null;
  full_name: string;
  nickname: string | null;
  sex: string | null;
  birth_date: string | null;
  death_date: string | null;
  is_living: boolean;
  location_text: string | null;
  location_scope: string | null;
  location_bucket: string | null;
};

type ParentChildRow = {
  parent_person_id: string;
  child_person_id: string;
  relationship_type: string;
};

type SpouseRow = {
  person_a_id: string;
  person_b_id: string;
  status: string;
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
    .select(
      "id,family_id,full_name,nickname,sex,birth_date,death_date,is_living,location_text,location_scope,location_bucket"
    )
    .in("id", ids);

  if (error) throw new Error(error.message);

  return (data ?? []) as PersonRow[];
}

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const authorization = await requireStaff(["admin", "dispatcher"]);

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          error: authorization.error,
        },
        authorization.status
      );
    }

    const familyId = cleanUuid(params.familyId);

    if (!familyId) {
      return noStore(
        {
          success: false,
          error: "Invalid family ID.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();

    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id,name,description")
      .eq("id", familyId)
      .maybeSingle();

    if (familyError) throw new Error(familyError.message);

    if (!family?.id) {
      return noStore(
        {
          success: false,
          error: "Family reunion not found.",
        },
        404
      );
    }

    const { data: projectPeopleRows, error: projectPeopleError } =
      await supabase
        .from("family_people")
        .select(
          "id,family_id,full_name,nickname,sex,birth_date,death_date,is_living,location_text,location_scope,location_bucket"
        )
        .eq("family_id", familyId)
        .order("full_name", { ascending: true });

    if (projectPeopleError) {
      throw new Error(projectPeopleError.message);
    }

    const projectPeople = (projectPeopleRows ?? []) as PersonRow[];

    if (projectPeople.length === 0) {
      return noStore({
        success: true,
        family: {
          id: family.id,
          name: family.name,
          description: family.description,
        },
        rootOptions: [],
        selectedRootId: null,
        generationLimit: cleanGenerationLimit(
          req.nextUrl.searchParams.get("generations")
        ),
        generations: [],
        edges: [],
        spouses: [],
      });
    }

    const projectPersonIds = projectPeople.map((person) => person.id);

    const { data: projectParentRows, error: projectParentsError } =
      await supabase
        .from("family_parent_child")
        .select("parent_person_id,child_person_id,relationship_type")
        .in("child_person_id", projectPersonIds)
        .eq("relationship_type", "biological");

    if (projectParentsError) {
      throw new Error(projectParentsError.message);
    }

    const projectChildIds = new Set(
      ((projectParentRows ?? []) as ParentChildRow[]).map(
        (row) => row.child_person_id
      )
    );

    const rootOptions = projectPeople
      .map((person) => ({
        id: person.id,
        fullName: person.full_name,
        nickname: person.nickname,
        locationText: person.location_text,
        locationBucket: person.location_bucket,
        suggestedRoot: !projectChildIds.has(person.id),
      }))
      .sort((a, b) => {
        if (a.suggestedRoot !== b.suggestedRoot) {
          return a.suggestedRoot ? -1 : 1;
        }

        return a.fullName.localeCompare(b.fullName, "en");
      });

    const requestedRootId = cleanUuid(
      req.nextUrl.searchParams.get("rootPersonId")
    );

    let selectedRootId = requestedRootId;

    if (
      !selectedRootId ||
      !projectPersonIds.includes(selectedRootId)
    ) {
      selectedRootId =
        rootOptions.find((person) => person.suggestedRoot)?.id ??
        rootOptions[0]?.id ??
        "";
    }

    if (!selectedRootId) {
      return noStore(
        {
          success: false,
          error: "No root person is available for this family.",
        },
        400
      );
    }

    const generationLimit = cleanGenerationLimit(
      req.nextUrl.searchParams.get("generations")
    );

    const generationByPersonId = new Map<string, number>();
    generationByPersonId.set(selectedRootId, 1);

    let frontier = [selectedRootId];
    const allEdges: ParentChildRow[] = [];

    for (
      let generation = 1;
      generation < generationLimit && frontier.length > 0;
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
        allEdges.push(edge);

        const nextGeneration = generation + 1;
        const knownGeneration = generationByPersonId.get(edge.child_person_id);

        if (
          knownGeneration === undefined ||
          nextGeneration < knownGeneration
        ) {
          generationByPersonId.set(edge.child_person_id, nextGeneration);
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
    const visiblePeople = await loadPeopleByIds(supabase, visiblePersonIds);
    const visiblePeopleById = new Map(
      visiblePeople.map((person) => [person.id, person] as const)
    );

    // Fetch every biological parent recorded for each visible person, not
    // only the parent edge used to reach that person from the selected root.
    // This allows an in-law spouse outside the descendant line to participate
    // in the couple unit without becoming a false descendant.
    const { data: completeParentRows, error: completeParentsError } =
      await supabase
        .from("family_parent_child")
        .select("parent_person_id,child_person_id,relationship_type")
        .in("child_person_id", visiblePersonIds)
        .eq("relationship_type", "biological");

    if (completeParentsError) {
      throw new Error(completeParentsError.message);
    }

    const completeBiologicalParents =
      (completeParentRows ?? []) as ParentChildRow[];

    const outsideParentIds = Array.from(
      new Set(
        completeBiologicalParents
          .map((edge) => edge.parent_person_id)
          .filter((id) => !visiblePeopleById.has(id))
      )
    );

    const outsideParentPeople = await loadPeopleByIds(
      supabase,
      outsideParentIds
    );

    const spouseRowsByPair = new Map<string, SpouseRow>();

    if (visiblePersonIds.length > 0) {
      const [{ data: spouseA, error: spouseAError }, { data: spouseB, error: spouseBError }] =
        await Promise.all([
          supabase
            .from("family_spouses")
            .select("person_a_id,person_b_id,status")
            .in("person_a_id", visiblePersonIds),
          supabase
            .from("family_spouses")
            .select("person_a_id,person_b_id,status")
            .in("person_b_id", visiblePersonIds),
        ]);

      if (spouseAError) throw new Error(spouseAError.message);
      if (spouseBError) throw new Error(spouseBError.message);

      for (const row of [
        ...((spouseA ?? []) as SpouseRow[]),
        ...((spouseB ?? []) as SpouseRow[]),
      ]) {
        const key = [row.person_a_id, row.person_b_id].sort().join(":");
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

    for (const edge of completeBiologicalParents) {
      const existing = parentIdsByChildId.get(edge.child_person_id) ?? [];
      if (!existing.includes(edge.parent_person_id)) {
        existing.push(edge.parent_person_id);
      }
      parentIdsByChildId.set(edge.child_person_id, existing);
    }

    const spouseSummariesByPersonId = new Map<
      string,
      {
        personId: string;
        fullName: string;
        status: string;
        locationText: string | null;
        locationBucket: string | null;
        isLiving: boolean;
      }[]
    >();

    for (const spouse of spouseRows) {
      const personA = allPeopleById.get(spouse.person_a_id);
      const personB = allPeopleById.get(spouse.person_b_id);

      if (personA && personB) {
        const aList = spouseSummariesByPersonId.get(personA.id) ?? [];
        aList.push({
          personId: personB.id,
          fullName: personB.full_name,
          status: spouse.status,
          locationText: personB.location_text,
          locationBucket: personB.location_bucket,
          isLiving: personB.is_living,
        });
        spouseSummariesByPersonId.set(personA.id, aList);

        const bList = spouseSummariesByPersonId.get(personB.id) ?? [];
        bList.push({
          personId: personA.id,
          fullName: personA.full_name,
          status: spouse.status,
          locationText: personA.location_text,
          locationBucket: personA.location_bucket,
          isLiving: personA.is_living,
        });
        spouseSummariesByPersonId.set(personB.id, bList);
      }
    }

    const generations = Array.from(
      { length: generationLimit },
      (_, index) => index + 1
    )
      .map((generation) => {
        const people = visiblePeople
          .filter(
            (person) =>
              generationByPersonId.get(person.id) === generation
          )
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "en"))
          .map((person) => ({
            id: person.id,
            familyId: person.family_id,
            fullName: person.full_name,
            nickname: person.nickname,
            sex: person.sex,
            birthDate: person.birth_date,
            deathDate: person.death_date,
            isLiving: person.is_living,
            locationText: person.location_text,
            locationScope: person.location_scope,
            locationBucket: person.location_bucket,
            parentIds: parentIdsByChildId.get(person.id) ?? [],
            spouses: spouseSummariesByPersonId.get(person.id) ?? [],
          }));

        return {
          generation,
          people,
        };
      })
      .filter((group) => group.people.length > 0);

    const visibleSet = new Set(visiblePersonIds);

    return noStore({
      success: true,
      family: {
        id: family.id,
        name: family.name,
        description: family.description,
      },
      rootOptions,
      selectedRootId,
      generationLimit,
      generations,
      edges: allEdges
        .filter(
          (edge) =>
            visibleSet.has(edge.parent_person_id) &&
            visibleSet.has(edge.child_person_id)
        )
        .map((edge) => ({
          parentPersonId: edge.parent_person_id,
          childPersonId: edge.child_person_id,
          relationshipType: edge.relationship_type,
        })),
      parentLinks: completeBiologicalParents.map((edge) => ({
        parentPersonId: edge.parent_person_id,
        childPersonId: edge.child_person_id,
        relationshipType: edge.relationship_type,
      })),
      outsideParents: outsideParentPeople.map((person) => ({
        id: person.id,
        familyId: person.family_id,
        fullName: person.full_name,
        nickname: person.nickname,
        sex: person.sex,
        birthDate: person.birth_date,
        deathDate: person.death_date,
        isLiving: person.is_living,
        locationText: person.location_text,
        locationScope: person.location_scope,
        locationBucket: person.location_bucket,
      })),
      spouses: spouseRows.map((row) => ({
        personAId: row.person_a_id,
        personBId: row.person_b_id,
        status: row.status,
      })),
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load family tree.",
      },
      500
    );
  }
}
