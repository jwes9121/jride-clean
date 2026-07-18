import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GuestLinkRow = {
  relationship: string;
  guest:
    | {
        id: string;
        full_name: string;
        registration_number: string;
        attendance_status: string;
      }
    | {
        id: string;
        full_name: string;
        registration_number: string;
        attendance_status: string;
      }[]
    | null;
};

type CheckpointRow = {
  id: string;
  checkpoint_no: number;
  checkpoint_name: string;
  sort_order: number;
};

type PassageRow = {
  id: string;
  attendee_id: string;
  checkpoint_id: string;
  passed_at: string;
};

function normalizeGuests(rows: GuestLinkRow[]) {
  return rows
    .map((row) => {
      const guest = Array.isArray(row.guest)
        ? row.guest[0]
        : row.guest;

      if (!guest) return null;

      return {
        attendeeId: guest.id,
        fullName: guest.full_name,
        registrationNumber:
          guest.registration_number,
        attendanceStatus:
          guest.attendance_status,
        relationship: row.relationship,
      };
    })
    .filter(Boolean);
}

function cleanQuery(value: string | null) {
  return String(value || "").trim();
}

function cleanPhone(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: {
      eventSlug: string;
    };
  }
) {
  try {
    const authorization =
      await requireStaff([
        "admin",
        "dispatcher",
      ]);

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          error: authorization.error,
        },
        authorization.status
      );
    }

    const q = cleanQuery(
      req.nextUrl.searchParams.get("q")
    );

    if (q.length < 2) {
      return noStore(
        {
          success: false,
          error:
            "Search query must be at least 2 characters.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } =
      await supabase
        .from("events")
        .select("id,slug,group_label")
        .eq("slug", params.eventSlug)
        .maybeSingle();

    if (eventError) {
      throw new Error(eventError.message);
    }

    if (!event?.id) {
      return noStore(
        {
          success: false,
          error: "Event not found.",
        },
        404
      );
    }

    const phone = cleanPhone(q);
    const escaped = q.replace(
      /[%_]/g,
      "\\$&"
    );

    const filters = [
      `registration_number.ilike.%${escaped}%`,
      `full_name.ilike.%${escaped}%`,
      `nickname.ilike.%${escaped}%`,
    ];

    if (phone.length >= 4) {
      filters.push(
        `mobile_number.ilike.%${phone}%`
      );
    }

    const [
      attendeesResult,
      checkpointsResult,
    ] = await Promise.all([
      supabase
        .from("event_attendees")
        .select(
          "id,full_name,mobile_number,nickname,group_value,registration_number,qr_token,registration_status,attendance_status,checked_in_at,is_disqualified,disqualification_reason,merged_into"
        )
        .eq("event_id", event.id)
        .is("merged_into", null)
        .or(filters.join(","))
        .order("reg_sequence", {
          ascending: false,
        })
        .limit(20),

      supabase
        .from("event_checkpoints")
        .select(
          "id,checkpoint_no,checkpoint_name,sort_order"
        )
        .eq("event_id", event.id)
        .order("sort_order", {
          ascending: true,
        }),
    ]);

    if (attendeesResult.error) {
      throw new Error(
        attendeesResult.error.message
      );
    }

    if (checkpointsResult.error) {
      throw new Error(
        checkpointsResult.error.message
      );
    }

    const rows =
      attendeesResult.data || [];

    const checkpoints =
      (checkpointsResult.data ||
        []) as CheckpointRow[];

    const primaryIds = rows.map(
      (row) => row.id
    );

    let guestsByPrimary = new Map<
      string,
      ReturnType<typeof normalizeGuests>
    >();

    let passagesByAttendee = new Map<
      string,
      PassageRow[]
    >();

    if (primaryIds.length > 0) {
      const [
        guestRowsResult,
        passagesResult,
      ] = await Promise.all([
        supabase
          .from("event_guest_links")
          .select(
            "primary_attendee_id,relationship,guest:event_attendees!event_guest_links_guest_attendee_id_fkey(id,full_name,registration_number,attendance_status)"
          )
          .eq("event_id", event.id)
          .in(
            "primary_attendee_id",
            primaryIds
          )
          .order("created_at", {
            ascending: true,
          }),

        supabase
          .from(
            "event_checkpoint_passages"
          )
          .select(
            "id,attendee_id,checkpoint_id,passed_at"
          )
          .eq("event_id", event.id)
          .in(
            "attendee_id",
            primaryIds
          )
          .order("passed_at", {
            ascending: true,
          }),
      ]);

      if (guestRowsResult.error) {
        throw new Error(
          guestRowsResult.error.message
        );
      }

      if (passagesResult.error) {
        throw new Error(
          passagesResult.error.message
        );
      }

      guestsByPrimary = new Map();

      for (const row of (
        guestRowsResult.data || []
      ) as (
        GuestLinkRow & {
          primary_attendee_id: string;
        }
      )[]) {
        const current =
          guestsByPrimary.get(
            row.primary_attendee_id
          ) || [];

        guestsByPrimary.set(
          row.primary_attendee_id,
          [
            ...current,
            ...normalizeGuests([row]),
          ]
        );
      }

      passagesByAttendee = new Map();

      for (const passage of (
        passagesResult.data || []
      ) as PassageRow[]) {
        const current =
          passagesByAttendee.get(
            passage.attendee_id
          ) || [];

        current.push(passage);

        passagesByAttendee.set(
          passage.attendee_id,
          current
        );
      }
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://app.jride.net";

    return noStore({
      success: true,
      eventSlug: event.slug,
      groupLabel:
        event.group_label || "Group",
      count: rows.length,
      results: rows.map((attendee) => {
        const passages =
          passagesByAttendee.get(
            attendee.id
          ) || [];

        const passageByCheckpointId =
          new Map<string, PassageRow>();

        for (const passage of passages) {
          if (
            !passageByCheckpointId.has(
              passage.checkpoint_id
            )
          ) {
            passageByCheckpointId.set(
              passage.checkpoint_id,
              passage
            );
          }
        }

        const checkpointTimeline =
          checkpoints.map(
            (checkpoint, index) => {
              const passage =
                passageByCheckpointId.get(
                  checkpoint.id
                );

              return {
                checkpointId:
                  checkpoint.id,
                checkpointNo:
                  checkpoint.checkpoint_no,
                checkpointName:
                  checkpoint.checkpoint_name,
                sortOrder:
                  checkpoint.sort_order,
                sequence: index + 1,
                status: passage
                  ? "passed"
                  : "missing",
                passageId:
                  passage?.id || null,
                passedAt:
                  passage?.passed_at ||
                  null,
              };
            }
          );

        const passedCheckpoints =
          checkpointTimeline.filter(
            (item) =>
              item.status === "passed"
          );

        const latestCheckpoint =
          passedCheckpoints.length > 0
            ? passedCheckpoints[
                passedCheckpoints.length -
                  1
              ]
            : null;

        const nextMissingCheckpoint =
          checkpointTimeline.find(
            (item) =>
              item.status === "missing"
          ) || null;

        const progressPercent =
          checkpoints.length > 0
            ? Math.round(
                (passedCheckpoints.length /
                  checkpoints.length) *
                  100
              )
            : 0;

        return {
          attendeeId: attendee.id,
          fullName:
            attendee.full_name,
          mobileNumber:
            attendee.mobile_number,
          nickname:
            attendee.nickname,
          groupValue:
            attendee.group_value,
          registrationNumber:
            attendee.registration_number,
          registrationStatus:
            attendee.registration_status,
          attendanceStatus:
            attendee.attendance_status,
          checkedInAt:
            attendee.checked_in_at,
          isDisqualified:
            attendee.is_disqualified,
          disqualificationReason:
            attendee.disqualification_reason,
          eventPassUrl: `${appUrl.replace(
            /\/$/,
            ""
          )}/events/${encodeURIComponent(
            event.slug
          )}/pass/${encodeURIComponent(
            attendee.registration_number
          )}?token=${encodeURIComponent(
            attendee.qr_token
          )}`,
          guests:
            guestsByPrimary.get(
              attendee.id
            ) || [],
          medicalLookup: {
            totalCheckpoints:
              checkpoints.length,
            passedCheckpoints:
              passedCheckpoints.length,
            missingCheckpoints:
              Math.max(
                0,
                checkpoints.length -
                  passedCheckpoints.length
              ),
            progressPercent,
            isComplete:
              checkpoints.length > 0 &&
              passedCheckpoints.length ===
                checkpoints.length,
            latestCheckpoint,
            nextMissingCheckpoint,
            lastKnownPassageAt:
              latestCheckpoint?.passedAt ||
              null,
            checkpointTimeline,
          },
        };
      }),
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Help Desk search failed.",
      },
      500
    );
  }
}
