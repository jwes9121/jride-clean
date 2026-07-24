import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_STATUSES = [
  "draft",
  "published",
  "registration_open",
  "registration_closed",
  "live",
  "completed",
  "archived",
] as const;

type EventStatus = (typeof VALID_STATUSES)[number];

type TransitionRpcRow = {
  success: boolean;
  event_id: string | null;
  previous_status: string | null;
  new_status: string | null;
  error_code: string | null;
  error_message: string | null;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function isEventStatus(value: string): value is EventStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
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
  { params }: { params: { eventSlug: string } }
) {
  try {
    const authorization = await requireStaff(["admin"]);

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          error: authorization.error,
        },
        authorization.status
      );
    }

    let body: Record<string, unknown> = {};

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const toStatus = cleanText(body.toStatus);
    const reason = cleanText(body.reason) || null;

    if (!toStatus || !isEventStatus(toStatus)) {
      return noStore(
        {
          success: false,
          error: "A valid toStatus is required.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();

    const { data, error } = await supabase.rpc(
      "transition_event_lifecycle",
      {
        p_event_slug: params.eventSlug,
        p_to_status: toStatus,
        p_actor_identifier: authorization.staff.id,
        p_actor_email: authorization.staff.email,
        p_actor_name: authorization.staff.name,
        p_actor_role: authorization.staff.role,
        p_reason: reason,
      }
    );

    if (error) {
      throw new Error(error.message);
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | TransitionRpcRow
      | null;

    if (!row) {
      return noStore(
        {
          success: false,
          error: "Lifecycle transition returned no result.",
        },
        500
      );
    }

    if (!row.success) {
      const statusByCode: Record<string, number> = {
        EVENT_NOT_FOUND: 404,
        INVALID_STATUS: 400,
        NO_OP_TRANSITION: 409,
        INVALID_TRANSITION: 409,
      };

      return noStore(
        {
          success: false,
          errorCode: row.error_code,
          error: row.error_message || "Lifecycle transition failed.",
          previousStatus: row.previous_status,
        },
        statusByCode[row.error_code || ""] || 400
      );
    }

    return noStore({
      success: true,
      eventId: row.event_id,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Lifecycle transition failed.",
      },
      500
    );
  }
}
