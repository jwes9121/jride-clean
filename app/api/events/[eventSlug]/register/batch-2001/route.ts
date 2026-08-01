import { NextRequest, NextResponse } from "next/server";
import { registerAttendee } from "@/lib/events/registration";
import { recordParticipation, type ParticipationEntry } from "@/lib/events/participation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_COMPANIONS = 3;

type CompanionInput = {
  fullName?: unknown;
  relationship?: unknown;
  joinFunWalk?: unknown;
  attendLunch?: unknown;
};

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));

    const morningRole = body.morningRole;

    if (morningRole !== "fun_walk" && morningRole !== "assist") {
      return noStore(
        {
          success: false,
          error: {
            code: "INVALID_MORNING_ROLE",
            message: 'morningRole must be "fun_walk" or "assist".',
          },
        },
        400
      );
    }

    if (typeof body.attendLunch !== "boolean") {
      return noStore(
        {
          success: false,
          error: {
            code: "INVALID_ATTEND_LUNCH",
            message: "attendLunch is required and must be true or false.",
          },
        },
        400
      );
    }

    const attendLunch: boolean = body.attendLunch;

    const companionsInput: CompanionInput[] = Array.isArray(body.companions)
      ? body.companions
      : [];

    if (companionsInput.length > MAX_COMPANIONS) {
      return noStore(
        {
          success: false,
          error: {
            code: "TOO_MANY_COMPANIONS",
            message: `A maximum of ${MAX_COMPANIONS} companions can be registered online.`,
          },
        },
        400
      );
    }

    for (let i = 0; i < companionsInput.length; i++) {
      const companion = companionsInput[i];

      if (typeof companion.joinFunWalk !== "boolean") {
        return noStore(
          {
            success: false,
            error: {
              code: "INVALID_COMPANION_ANSWER",
              message: `Companion ${i + 1}: joinFunWalk is required and must be true or false.`,
            },
          },
          400
        );
      }

      if (typeof companion.attendLunch !== "boolean") {
        return noStore(
          {
            success: false,
            error: {
              code: "INVALID_COMPANION_ANSWER",
              message: `Companion ${i + 1}: attendLunch is required and must be true or false.`,
            },
          },
          400
        );
      }
    }

    const supabase = supabaseAdmin();

    const result = await registerAttendee(
      supabase,
      {
        ...body,
        eventSlug: params.eventSlug,
        groupValue: "batch_2001_member",
        guests: companionsInput.map((companion) => ({
          fullName: String(companion.fullName || ""),
          relationship: String(companion.relationship || ""),
          hasOwnQr: true,
        })),
      },
      {
        source: "online",
      }
    );

    // Identity resolution (unchanged, event-wide by mobile number - not
    // scoped by group_value) can match this submission to an attendee who
    // registered through a different flow entirely. Writing fresh Batch
    // 2001 participation onto that pre-existing record would be wrong
    // regardless of which flow it originally came through, so this always
    // short-circuits rather than silently discarding or silently applying
    // the submitted answers. The frontend must show this message before
    // any redirect, not just reuse the public page's 2-second auto-redirect.
    if (result.success && result.existingRegistration) {
      return noStore(
        {
          ...result,
          participationRecorded: false,
          specialRegistrationNotApplied: true,
          message:
            "This mobile number already has an Event Pass. Please visit Event Registration and Assistance so your Batch 2001 participation details can be updated.",
        },
        200
      );
    }

    let participationRecorded = false;

    if (result.success && result.attendeeId) {
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("id")
        .eq("slug", params.eventSlug)
        .maybeSingle();

      if (eventError) {
        console.error("batch-2001 register: event lookup for participation failed", {
          eventSlug: params.eventSlug,
          attendeeId: result.attendeeId,
          message: eventError.message,
        });
      }

      if (event?.id) {
        const entries: ParticipationEntry[] = [
          {
            attendeeId: result.attendeeId,
            funWalk: morningRole === "fun_walk",
            assist: morningRole === "assist",
            lunchMeetGreet: attendLunch,
          },
          ...(result.guests || []).map((guest, index) => ({
            attendeeId: guest.attendeeId,
            funWalk: companionsInput[index]?.joinFunWalk === true,
            assist: false,
            lunchMeetGreet: companionsInput[index]?.attendLunch === true,
          })),
        ];

        const participationResult = await recordParticipation(supabase, {
          eventId: event.id,
          entries,
        });

        participationRecorded = participationResult.ok;
      }
    }

    const status = result.success ? 200 : 400;
    return noStore({ ...result, participationRecorded }, status);
  } catch (error) {
    return noStore(
      {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: error instanceof Error ? error.message : "Registration failed.",
        },
      },
      500
    );
  }
}
