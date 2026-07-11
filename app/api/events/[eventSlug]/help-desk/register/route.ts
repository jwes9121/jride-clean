// app/api/events/[eventSlug]/help-desk/register/route.ts
//
// Walk-in registration endpoint for the Volunteer Console.
// Thin wrapper -- all business logic lives in lib/events/registration.ts.
//
// Differs from the public /register route only in context:
//   source:       "walk_in"   (public uses "online")
//   registeredBy: omitted until an authenticated staff UUID is available
//
// Preserves: duplicate detection, registration numbers, QR generation,
//            guest linking, identity resolution, pass URL construction.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { registerAttendee } from "@/lib/events/registration";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const { eventSlug } = params;

    if (!eventSlug) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_PARAMS", message: "Event slug is required." } },
        { status: 400 }
      );
    }

    const result = await registerAttendee(
      supabaseAdmin(),
      {
        eventSlug,
        fullName: body.fullName ?? "",
        mobileNumber: body.mobileNumber ?? "",
        groupValue: body.groupValue ?? "",
        nickname: body.nickname ?? "",
        guests: Array.isArray(body.guests) ? body.guests : [],
      },
      {
        source: "walk_in",
      }
    );

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: error instanceof Error ? error.message : "Registration failed.",
        },
      },
      { status: 500 }
    );
  }
}
