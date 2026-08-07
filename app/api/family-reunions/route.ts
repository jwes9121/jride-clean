import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(_req: NextRequest) {
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

    const supabase = supabaseAdmin();

    const { data: familyRows, error: familyError } = await supabase
      .from("families")
      .select("id,name,description,created_at,updated_at")
      .order("name", { ascending: true });

    if (familyError) throw new Error(familyError.message);

    const families = familyRows ?? [];
    const familyIds = families.map((row) => String(row.id));

    let peopleCounts = new Map<string, number>();

    if (familyIds.length > 0) {
      const { data: peopleRows, error: peopleError } = await supabase
        .from("family_people")
        .select("family_id")
        .in("family_id", familyIds);

      if (peopleError) throw new Error(peopleError.message);

      peopleCounts = new Map();

      for (const row of peopleRows ?? []) {
        const familyId = String(row.family_id || "");
        if (!familyId) continue;
        peopleCounts.set(familyId, (peopleCounts.get(familyId) ?? 0) + 1);
      }
    }

    return noStore({
      success: true,
      families: families.map((family) => ({
        id: family.id,
        name: family.name,
        description: family.description,
        createdAt: family.created_at,
        updatedAt: family.updated_at,
        peopleCount: peopleCounts.get(String(family.id)) ?? 0,
      })),
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load family reunions.",
      },
      500
    );
  }
}
