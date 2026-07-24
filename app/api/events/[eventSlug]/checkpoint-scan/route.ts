import { NextRequest, NextResponse } from "next/server";
import {
  EVENT_NOT_CHECKIN_OPEN_RESPONSE,
  isCheckinOpen,
} from "@/lib/events/checkinLifecycle";
import { requireEventStation } from "@/lib/events/requireEventStation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckpointPassageRpcRow = {
  inserted: boolean;
  passage_id: string;
  effective_passed_at: string;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: { eventSlug: string };
  }
) {
  try {
    const eventSlug = cleanText(params.eventSlug);

    if (!eventSlug) {
      return noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      );
    }

    const stationToken = cleanText(
      req.headers.get("x-event-station-token")
    );

    const body = await req
      .json()
      .catch(() => ({}));

    const registrationNumber = cleanText(
      body.registrationNumber
    );

    const qrToken = cleanText(
      body.qrToken
    );

    if (!registrationNumber || !qrToken) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message:
            "Registration number and QR token are required.",
        },
        400
      );
    }

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
      return noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      );
    }

    const stationAuthorization =
      await requireEventStation(
        supabase,
        event.id,
        stationToken,
        "checkpoint"
      );

    if (!stationAuthorization.ok) {
      return noStore(
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
      );
    }

    if (!isCheckinOpen(event.status)) {
      return noStore(
        EVENT_NOT_CHECKIN_OPEN_RESPONSE,
        409
      );
    }

    const checkpointId =
      stationAuthorization.station.checkpointId;

    if (!checkpointId) {
      return noStore(
        {
          success: false,
          reason: "station_auth_required",
          message:
            "Checkpoint station is not assigned to a checkpoint.",
        },
        401
      );
    }

    const { data: checkpoint, error: checkpointError } =
      await supabase
        .from("event_checkpoints")
        .select(
          "id,checkpoint_name,checkpoint_no,sort_order"
        )
        .eq("id", checkpointId)
        .eq("event_id", event.id)
        .maybeSingle();

    if (checkpointError) {
      throw new Error(checkpointError.message);
    }

    if (!checkpoint?.id) {
      return noStore(
        {
          success: false,
          reason: "checkpoint_not_found",
          message:
            "The checkpoint assigned to this station was not found.",
        },
        409
      );
    }

    const { data: attendee, error: attendeeError } =
      await supabase
        .from("event_attendees")
        .select(
          "id,full_name,registration_number,is_disqualified,disqualification_reason,merged_into"
        )
        .eq("event_id", event.id)
        .eq("registration_number", registrationNumber)
        .eq("qr_token", qrToken)
        .maybeSingle();

    if (attendeeError) {
      throw new Error(attendeeError.message);
    }

    if (!attendee?.id || attendee.merged_into) {
      return noStore(
        {
          success: false,
          reason: "invalid_token",
          message: "Event Pass is invalid.",
        },
        404
      );
    }

    if (attendee.is_disqualified) {
      return noStore(
        {
          success: false,
          reason: "attendee_not_eligible",
          attendeeId: attendee.id,
          fullName: attendee.full_name,
          registrationNumber:
            attendee.registration_number,
          message:
            cleanText(
              attendee.disqualification_reason
            ) ||
            "Participant is not eligible for checkpoint recording.",
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
          p_station_token_id:
            stationAuthorization.station.id,
        }
      );

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const row = (
      Array.isArray(data)
        ? data[0]
        : data
    ) as CheckpointPassageRpcRow | null;

    if (
      !row?.passage_id ||
      !row.effective_passed_at
    ) {
      throw new Error(
        "Checkpoint passage returned no result."
      );
    }

    const duplicate = row.inserted !== true;

    return noStore(
      {
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
          id: stationAuthorization.station.id,
          name:
            stationAuthorization.station.stationName,
        },
        attendee: {
          id: attendee.id,
          fullName: attendee.full_name,
          registrationNumber:
            attendee.registration_number,
        },
        message: duplicate
          ? `${checkpoint.checkpoint_name} was already recorded.`
          : `${checkpoint.checkpoint_name} recorded successfully.`,
      },
      200
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Checkpoint scan failed.",
      },
      500
    );
  }
}
