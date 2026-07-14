import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

    const issuerEmail = cleanText(authorization.staff.email).toLowerCase();

    if (!issuerEmail) {
      return noStore(
        {
          success: false,
          error: "STAFF_EMAIL_REQUIRED",
        },
        403
      );
    }

    const body = await req.json().catch(() => ({}));

    const stationName = cleanText(body.stationName);
    const expiresAtRaw = cleanText(body.expiresAt);

    if (stationName.length < 2 || stationName.length > 80) {
      return noStore(
        {
          success: false,
          error: "Station name must be between 2 and 80 characters.",
        },
        400
      );
    }

    if (!expiresAtRaw) {
      return noStore(
        {
          success: false,
          error: "expiresAt is required.",
        },
        400
      );
    }

    const expiresAt = new Date(expiresAtRaw);

    if (Number.isNaN(expiresAt.getTime())) {
      return noStore(
        {
          success: false,
          error: "expiresAt must be a valid ISO date and time.",
        },
        400
      );
    }

    const now = new Date();
    const maximumExpiry = new Date(
      now.getTime() + 366 * 24 * 60 * 60 * 1000
    );

    if (expiresAt.getTime() <= now.getTime()) {
      return noStore(
        {
          success: false,
          error: "expiresAt must be in the future.",
        },
        400
      );
    }

    if (expiresAt.getTime() > maximumExpiry.getTime()) {
      return noStore(
        {
          success: false,
          error: "expiresAt cannot be more than 366 days in the future.",
        },
        400
      );
    }

    const eventSlug = cleanText(params.eventSlug);

    if (!eventSlug) {
      return noStore(
        {
          success: false,
          error: "Event slug is required.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,slug,name")
      .eq("slug", eventSlug)
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

    const plaintextToken = `jrst_${randomBytes(32).toString("hex")}`;
    const tokenHash = sha256Hex(plaintextToken);

    const { data: station, error: insertError } = await supabase
      .from("event_station_tokens")
      .insert({
        event_id: event.id,
        station_type: "scanner",
        station_name: stationName,
        token_hash: tokenHash,
        status: "active",
        issued_by_email: issuerEmail,
        expires_at: expiresAt.toISOString(),
      })
      .select(
        "id,event_id,station_type,station_name,status,issued_by_email,issued_at,expires_at"
      )
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return noStore(
          {
            success: false,
            error:
              "An active scanner station with this name already exists for the event.",
          },
          409
        );
      }

      throw new Error(insertError.message);
    }

    return noStore(
      {
        success: true,
        warning:
          "Copy this token now. JRide stores only its SHA-256 hash and cannot display it again.",
        event: {
          eventId: event.id,
          eventSlug: event.slug,
          eventName: event.name,
        },
        station: {
          stationTokenId: station.id,
          stationType: station.station_type,
          stationName: station.station_name,
          status: station.status,
          issuedByEmail: station.issued_by_email,
          issuedAt: station.issued_at,
          expiresAt: station.expires_at,
        },
        stationToken: plaintextToken,
      },
      201
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Scanner station token issuance failed.",
      },
      500
    );
  }
}