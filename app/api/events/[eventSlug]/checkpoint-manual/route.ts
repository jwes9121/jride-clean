import { NextRequest, NextResponse } from "next/server";
import {
  EVENT_NOT_CHECKIN_OPEN_RESPONSE,
  isCheckinOpen,
} from "@/lib/events/checkinLifecycle";
import { requireEventStation } from "@/lib/events/requireEventStation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckpointContext = {
  supabase: any;
  event: {
    id: string;
    slug: string;
    status: string;
  };
  station: {
    id: string;
    stationName: string;
    checkpointId: string | null;
  };
  checkpoint: {
    id: string;
    checkpoint_name: string;
    checkpoint_no: number;
    sort_order: number;
  };
};

type ContextResult =
  | {
      ok: true;
      context: CheckpointContext;
    }
  | {
      ok: false;
      response: NextResponse;
    };

type PassageRpcRow = {
  inserted: boolean;
  passage_id: string;
  effective_passed_at: string;
};

const MANUAL_REASONS = new Set([
  "qr_unreadable",
  "pass_link_unavailable",
  "no_phone",
  "assisted_identity_verification",
  "other",
]);

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function phoneDigits(value: unknown) {
  return cleanText(value).replace(/[^0-9]/g, "");
}

function maskPhone(value: unknown) {
  const digits = phoneDigits(value);

  if (digits.length < 4) return null;

  return `***${digits.slice(-4)}`;
}

function normalizeTicketNumber(value: unknown) {
  const compact = cleanText(value)
    .toUpperCase()
    .replace(/\s+/g, "");

  if (/^[0-9]{1,4}$/.test(compact)) {
    return `FR-${compact.padStart(3, "0")}`;
  }

  const match = compact.match(
    /^(FR|SP)-?([0-9]{1,4})$/
  );

  if (!match) return "";

  return `${match[1]}-${match[2].padStart(
    3,
    "0"
  )}`;
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function loadCheckpointContext(
  req: NextRequest,
  eventSlug: string
): Promise<ContextResult> {
  if (!eventSlug) {
    return {
      ok: false,
      response: noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      ),
    };
  }

  const stationToken = cleanText(
    req.headers.get("x-event-station-token")
  );
  const supabase = supabaseAdmin();

  const { data: event, error: eventError } =
    await supabase
      .from("events")
      .select("id,slug,status")
      .eq("slug", eventSlug)
      .maybeSingle();

  if (eventError) {
    throw new Error(eventError.message);
  }

  if (!event?.id) {
    return {
      ok: false,
      response: noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      ),
    };
  }

  const stationAuthorization =
    await requireEventStation(
      supabase,
      event.id,
      stationToken,
      "checkpoint"
    );

  if (!stationAuthorization.ok) {
    return {
      ok: false,
      response: noStore(
        {
          success: false,
          reason: "station_auth_required",
          message:
            stationAuthorization.error ===
            "STATION_TOKEN_REQUIRED"
              ? "Checkpoint station authorization is required."
              : "Checkpoint station token is invalid, expired, or revoked.",
        },
        stationAuthorization.status
      ),
    };
  }

  const checkpointId =
    stationAuthorization.station.checkpointId;

  if (!checkpointId) {
    return {
      ok: false,
      response: noStore(
        {
          success: false,
          reason: "checkpoint_not_found",
          message:
            "This station is not assigned to a checkpoint.",
        },
        409
      ),
    };
  }

  const { data: checkpoint, error: checkpointError } =
    await supabase
      .from("event_checkpoints")
      .select(
        "id,checkpoint_name,checkpoint_no,sort_order"
      )
      .eq("event_id", event.id)
      .eq("id", checkpointId)
      .maybeSingle();

  if (checkpointError) {
    throw new Error(checkpointError.message);
  }

  if (!checkpoint?.id) {
    return {
      ok: false,
      response: noStore(
        {
          success: false,
          reason: "checkpoint_not_found",
          message:
            "The checkpoint assigned to this station was not found.",
        },
        409
      ),
    };
  }

  return {
    ok: true,
    context: {
      supabase,
      event,
      station: {
        id: stationAuthorization.station.id,
        stationName:
          stationAuthorization.station.stationName,
        checkpointId,
      },
      checkpoint,
    },
  };
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
    const eventSlug = cleanText(params.eventSlug);
    const loaded = await loadCheckpointContext(
      req,
      eventSlug
    );

    if (!loaded.ok) return loaded.response;

    const {
      supabase,
      event,
      station,
      checkpoint,
    } = loaded.context;

    const rawQuery = cleanText(
      req.nextUrl.searchParams.get("q")
    );
    const safeQuery = rawQuery
      .replace(/[^A-Za-z0-9 .'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    const baseResponse = {
      success: true,
      eventStatus: event.status,
      station: {
        id: station.id,
        name: station.stationName,
      },
      checkpoint: {
        id: checkpoint.id,
        name: checkpoint.checkpoint_name,
        number: checkpoint.checkpoint_no,
        sortOrder: checkpoint.sort_order,
      },
    };

    if (safeQuery.length < 2) {
      return noStore({
        ...baseResponse,
        results: [],
      });
    }

    const selectColumns =
      "id,full_name,registration_number,mobile_number,group_value,attendance_status,is_disqualified,disqualification_reason,merged_into";
    const attendeeMap = new Map<string, any>();

    async function addRows(result: any) {
      if (result.error) {
        throw new Error(result.error.message);
      }

      for (const row of result.data || []) {
        if (row?.id && !row.merged_into) {
          attendeeMap.set(row.id, row);
        }
      }
    }

    await addRows(
      await supabase
        .from("event_attendees")
        .select(selectColumns)
        .eq("event_id", event.id)
        .ilike("full_name", `%${safeQuery}%`)
        .limit(10)
    );

    await addRows(
      await supabase
        .from("event_attendees")
        .select(selectColumns)
        .eq("event_id", event.id)
        .ilike(
          "registration_number",
          `%${safeQuery.toUpperCase()}%`
        )
        .limit(10)
    );

    const digits = phoneDigits(rawQuery);

    if (digits.length >= 4) {
      await addRows(
        await supabase
          .from("event_attendees")
          .select(selectColumns)
          .eq("event_id", event.id)
          .ilike("mobile_number", `%${digits}%`)
          .limit(10)
      );
    }

    const normalizedTicket =
      normalizeTicketNumber(rawQuery);

    if (normalizedTicket) {
      const ticketResult = await supabase
        .from("event_tickets")
        .select("claimed_attendee_id")
        .eq("event_id", event.id)
        .eq("ticket_number", normalizedTicket)
        .maybeSingle();

      if (ticketResult.error) {
        throw new Error(ticketResult.error.message);
      }

      if (ticketResult.data?.claimed_attendee_id) {
        await addRows(
          await supabase
            .from("event_attendees")
            .select(selectColumns)
            .eq("event_id", event.id)
            .eq(
              "id",
              ticketResult.data.claimed_attendee_id
            )
            .limit(1)
        );
      }
    }

    const attendees = Array.from(
      attendeeMap.values()
    ).slice(0, 15);
    const attendeeIds = attendees.map(
      (row) => row.id
    );
    const passageByAttendee = new Map<
      string,
      string
    >();

    if (attendeeIds.length > 0) {
      const passageResult = await supabase
        .from("event_checkpoint_passages")
        .select("attendee_id,passed_at")
        .eq("event_id", event.id)
        .eq("checkpoint_id", checkpoint.id)
        .in("attendee_id", attendeeIds);

      if (passageResult.error) {
        throw new Error(passageResult.error.message);
      }

      for (const row of passageResult.data || []) {
        passageByAttendee.set(
          row.attendee_id,
          row.passed_at
        );
      }
    }

    const exact = safeQuery.toUpperCase();

    attendees.sort((a, b) => {
      const aExact =
        String(a.registration_number || "")
          .toUpperCase() === exact
          ? 0
          : 1;
      const bExact =
        String(b.registration_number || "")
          .toUpperCase() === exact
          ? 0
          : 1;

      if (aExact !== bExact) {
        return aExact - bExact;
      }

      return String(a.full_name || "").localeCompare(
        String(b.full_name || "")
      );
    });

    return noStore({
      ...baseResponse,
      results: attendees.map((row) => ({
        attendeeId: row.id,
        fullName: row.full_name,
        registrationNumber:
          row.registration_number,
        mobileMasked: maskPhone(
          row.mobile_number
        ),
        groupValue: row.group_value,
        attendanceStatus:
          row.attendance_status,
        isDisqualified:
          row.is_disqualified === true,
        disqualificationReason:
          row.disqualification_reason || null,
        alreadyRecorded:
          passageByAttendee.has(row.id),
        recordedAt:
          passageByAttendee.get(row.id) || null,
      })),
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Manual checkpoint search failed.",
      },
      500
    );
  }
}

export async function POST(
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
    const eventSlug = cleanText(params.eventSlug);
    const loaded = await loadCheckpointContext(
      req,
      eventSlug
    );

    if (!loaded.ok) return loaded.response;

    const {
      supabase,
      event,
      station,
      checkpoint,
    } = loaded.context;

    if (!isCheckinOpen(event.status)) {
      return noStore(
        EVENT_NOT_CHECKIN_OPEN_RESPONSE,
        409
      );
    }

    const body = await req
      .json()
      .catch(() => ({}));
    const attendeeId = cleanText(
      body.attendeeId
    );
    const reason = cleanText(
      body.reason
    ).toLowerCase();
    const note = cleanText(body.note).slice(0, 250);

    if (
      !attendeeId ||
      !MANUAL_REASONS.has(reason)
    ) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message:
            "Attendee and a valid manual-entry reason are required.",
        },
        400
      );
    }

    if (reason === "other" && note.length < 3) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message:
            "Enter a short note when Other is selected.",
        },
        400
      );
    }

    const { data: attendee, error: attendeeError } =
      await supabase
        .from("event_attendees")
        .select(
          "id,full_name,registration_number,attendance_status,checked_in_at,is_disqualified,disqualification_reason,merged_into"
        )
        .eq("event_id", event.id)
        .eq("id", attendeeId)
        .maybeSingle();

    if (attendeeError) {
      throw new Error(attendeeError.message);
    }

    if (!attendee?.id || attendee.merged_into) {
      return noStore(
        {
          success: false,
          reason: "attendee_not_found",
          message:
            "Participant was not found for this event.",
        },
        404
      );
    }

    if (attendee.is_disqualified) {
      return noStore(
        {
          success: false,
          reason: "attendee_not_eligible",
          message:
            attendee.disqualification_reason ||
            "Participant is not eligible for checkpoint recording.",
        },
        409
      );
    }

    if (
      attendee.attendance_status !== "checked_in" ||
      !attendee.checked_in_at
    ) {
      return noStore(
        {
          success: false,
          reason: "attendance_required",
          message:
            "Gate attendance must be recorded before Start or Finish. Send the participant to the Gate Scanner or Help Desk Manual Check-In first.",
        },
        409
      );
    }

    const { data, error: rpcError } =
      await supabase.rpc(
        "record_event_checkpoint_passage",
        {
          p_event_id: event.id,
          p_checkpoint_id: checkpoint.id,
          p_attendee_id: attendee.id,
          p_station_token_id: station.id,
        }
      );

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const row = (
      Array.isArray(data)
        ? data[0]
        : data
    ) as PassageRpcRow | null;

    if (
      !row?.passage_id ||
      !row.effective_passed_at
    ) {
      throw new Error(
        "Checkpoint passage returned no result."
      );
    }

    const duplicate = row.inserted !== true;

    const { error: auditError } =
      await supabase
        .from("event_audit_logs")
        .insert({
          event_id: event.id,
          attendee_id: attendee.id,
          actor_id: null,
          action:
            "event_checkpoint_manual_record",
          details: {
            checkpoint_id: checkpoint.id,
            checkpoint_name:
              checkpoint.checkpoint_name,
            checkpoint_no:
              checkpoint.checkpoint_no,
            station_token_id: station.id,
            station_name:
              station.stationName,
            manual_reason: reason,
            note: note || null,
            duplicate,
          },
        });

    if (auditError) {
      console.error(
        "[event-checkpoint-manual-audit]",
        auditError.message
      );
    }

    return noStore({
      success: true,
      reason: duplicate
        ? "already_recorded"
        : "checkpoint_recorded",
      duplicate,
      passageId: row.passage_id,
      passedAt: row.effective_passed_at,
      checkpoint: {
        id: checkpoint.id,
        name: checkpoint.checkpoint_name,
        number: checkpoint.checkpoint_no,
        sortOrder: checkpoint.sort_order,
      },
      station: {
        id: station.id,
        name: station.stationName,
      },
      attendee: {
        id: attendee.id,
        fullName: attendee.full_name,
        registrationNumber:
          attendee.registration_number,
        attendanceStatus:
          attendee.attendance_status,
      },
      message: duplicate
        ? `${checkpoint.checkpoint_name} was already recorded.`
        : `${checkpoint.checkpoint_name} recorded manually.`,
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Manual checkpoint recording failed.",
      },
      500
    );
  }
}