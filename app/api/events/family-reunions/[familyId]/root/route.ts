import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
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

export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const authorization = await requireStaff(["admin"]);

    if (!authorization.ok) {
      return noStore(
        { success: false, error: authorization.error },
        authorization.status
      );
    }

    const familyId = cleanUuid(params.familyId);

    if (!familyId) {
      return noStore({ success: false, error: "Invalid family ID." }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const rawRootPersonId = String(body.rootPersonId || "").trim();
    const rootPersonId = rawRootPersonId ? cleanUuid(rawRootPersonId) : "";

    if (rawRootPersonId && !rootPersonId) {
      return noStore(
        { success: false, error: "Invalid root person ID." },
        400
      );
    }

    const supabase = supabaseAdmin();

    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id,name")
      .eq("id", familyId)
      .maybeSingle();

    if (familyError) throw new Error(familyError.message);

    if (!family?.id) {
      return noStore(
        { success: false, error: "Family reunion not found." },
        404
      );
    }

    if (rootPersonId) {
      const { data: person, error: personError } = await supabase
        .from("family_people")
        .select("id,full_name")
        .eq("id", rootPersonId)
        .maybeSingle();

      if (personError) throw new Error(personError.message);

      if (!person?.id) {
        return noStore(
          { success: false, error: "Selected root person was not found." },
          404
        );
      }
    }

    const { data: updatedFamily, error: updateError } = await supabase
      .from("families")
      .update({
        display_root_person_id: rootPersonId || null,
      })
      .eq("id", familyId)
      .select("id,name,display_root_person_id")
      .single();

    if (updateError) {
      if (updateError.message.includes("FAMILY_DISPLAY_ROOT_NOT_CONNECTED")) {
        return noStore(
          {
            success: false,
            error:
              "The selected person is not connected to this family's genealogy graph.",
          },
          409
        );
      }

      throw new Error(updateError.message);
    }

    return noStore({
      success: true,
      family: {
        id: updatedFamily.id,
        name: updatedFamily.name,
        displayRootPersonId: updatedFamily.display_root_person_id,
      },
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update family tree root.",
      },
      500
    );
  }
}
