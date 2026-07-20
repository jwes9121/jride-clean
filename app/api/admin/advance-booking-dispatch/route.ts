import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { auth } from "../../../../auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIVE_STATUSES = new Set([
  "open",
  "fare_proposed",
  "fare_accepted",
  "pickup_fee_pending",
  "pickup_fee_proposed",
  "confirmed",
  "converting",
  "live",
  "dispatcher_intervention",
]);

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeStatus(value: unknown): string {
  return text(value).toLowerCase();
}

function isStaffRole(role: unknown) {
  const value = normalizeStatus(role);
  return value === "admin" || value === "dispatcher";
}

async function requireStaff() {
  const session = await auth();
  const role = (session?.user as any)?.role ?? "user";

  if (!isStaffRole(role)) {
    return {
      ok: false as const,
    };
  }

  return {
    ok: true as const,
  };
}

function getAdmin() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !key) {
    return null;
  }

  return createAdminClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function minutesUntil(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;

  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return null;

  return Math.ceil((timestamp - Date.now()) / 60000);
}

function passengerCountFromNotes(notes: unknown): number | null {
  const match = text(notes).match(/\[Passenger count\]\s*(\d+)/i);
  if (!match) return null;

  const count = Number(match[1]);
  return Number.isInteger(count) && count >= 1 && count <= 4
    ? count
    : null;
}

export async function GET(req: NextRequest) {
  const gate = await requireStaff();

  if (!gate.ok) {
    return json(403, {
      ok: false,
      error: "FORBIDDEN",
      message: "Forbidden",
    });
  }

  const admin = getAdmin();

  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing Supabase service role configuration.",
    });
  }

  const requestedFilter = normalizeStatus(
    req.nextUrl.searchParams.get("filter") || "active"
  );

  const bookingResult = await admin
    .from("advance_bookings")
    .select(
      [
        "id",
        "passenger_id",
        "pickup_town",
        "pickup_address",
        "destination_address",
        "distance_km",
        "vehicle_type",
        "notes",
        "scheduled_pickup_at",
        "booking_created_at",
        "booking_expires_at",
        "booking_mode",
        "fare_bracket",
        "estimated_fare_min",
        "estimated_fare_max",
        "estimated_pickup_fee",
        "estimated_total",
        "proposed_ride_fare",
        "proposed_platform_fee",
        "pickup_fee",
        "total_fare",
        "committed_driver_id",
        "committed_at",
        "live_booking_id",
        "converted_at",
        "status",
        "escalation_level",
        "dispatcher_alerted_at",
        "cancelled_at",
        "cancellation_reason",
        "cancelled_by",
        "updated_at",
        "offer_started_at",
        "current_offer_queue_id",
        "total_offers_sent",
        "total_passenger_declines",
        "driver_reserved_at",
        "driver_locked_at",
        "passenger_response_expires_at",
        "departure_option_used",
      ].join(", ")
    )
    .order("scheduled_pickup_at", { ascending: true })
    .limit(500);

  if (bookingResult.error) {
    return json(500, {
      ok: false,
      error: "ADVANCE_BOOKINGS_READ_FAILED",
      message: bookingResult.error.message,
    });
  }

  const bookingRows = Array.isArray(bookingResult.data)
    ? bookingResult.data
    : [];

  const passengerIds = Array.from(
    new Set(
      bookingRows
        .map((row: any) => text(row?.passenger_id))
        .filter(Boolean)
    )
  );

  const queueIds = Array.from(
    new Set(
      bookingRows
        .map((row: any) => text(row?.current_offer_queue_id))
        .filter(Boolean)
    )
  );

  const committedDriverIds = Array.from(
    new Set(
      bookingRows
        .map((row: any) => text(row?.committed_driver_id))
        .filter(Boolean)
    )
  );

  const passengerById: Record<
    string,
    {
      full_name: string | null;
      phone: string | null;
      email: string | null;
      town_origin: string | null;
    }
  > = {};

  if (passengerIds.length > 0) {
    const passengerResult = await admin
      .from("passenger_profiles")
      .select("user_id,full_name,phone,email,town_origin")
      .in("user_id", passengerIds);

    if (passengerResult.error) {
      return json(500, {
        ok: false,
        error: "PASSENGER_PROFILES_READ_FAILED",
        message: passengerResult.error.message,
      });
    }

    for (const row of passengerResult.data ?? []) {
      const id = text((row as any)?.user_id);
      if (!id) continue;

      passengerById[id] = {
        full_name: text((row as any)?.full_name) || null,
        phone: text((row as any)?.phone) || null,
        email: text((row as any)?.email) || null,
        town_origin: text((row as any)?.town_origin) || null,
      };
    }
  }

  const queueById: Record<string, any> = {};
  const queueDriverIds: string[] = [];

  if (queueIds.length > 0) {
    const queueResult = await admin
      .from("advance_booking_queue")
      .select(
        [
          "id",
          "advance_booking_id",
          "driver_id",
          "joined_at",
          "status",
          "removed_at",
          "removal_reason",
          "stagger_position",
          "offer_sent_at",
          "offer_expires_at",
          "departure_option",
          "pickup_fee_computed",
          "departure_distance_km",
          "fare_locked_total",
          "commitment_confirmed",
          "fare_preparation_expires_at",
        ].join(", ")
      )
      .in("id", queueIds);

    if (queueResult.error) {
      return json(500, {
        ok: false,
        error: "ADVANCE_BOOKING_QUEUE_READ_FAILED",
        message: queueResult.error.message,
      });
    }

    for (const row of queueResult.data ?? []) {
      const id = text((row as any)?.id);
      const driverId = text((row as any)?.driver_id);

      if (id) {
        queueById[id] = row;
      }

      if (driverId) {
        queueDriverIds.push(driverId);
      }
    }
  }

  const allDriverIds = Array.from(
    new Set([...committedDriverIds, ...queueDriverIds])
  );

  const driverById: Record<
    string,
    {
      driver_name: string | null;
      driver_status: string | null;
    }
  > = {};

  if (allDriverIds.length > 0) {
    const driverResult = await admin
      .from("drivers")
      .select("id,driver_name,driver_status")
      .in("id", allDriverIds);

    if (driverResult.error) {
      return json(500, {
        ok: false,
        error: "DRIVERS_READ_FAILED",
        message: driverResult.error.message,
      });
    }

    for (const row of driverResult.data ?? []) {
      const id = text((row as any)?.id);
      if (!id) continue;

      driverById[id] = {
        driver_name: text((row as any)?.driver_name) || null,
        driver_status: text((row as any)?.driver_status) || null,
      };
    }
  }

  const bookings = bookingRows.map((row: any) => {
    const passengerId = text(row?.passenger_id);
    const queueId = text(row?.current_offer_queue_id);
    const committedDriverId = text(row?.committed_driver_id);
    const queue = queueId ? queueById[queueId] ?? null : null;
    const queueDriverId = text(queue?.driver_id);
    const currentDriverId =
      committedDriverId ||
      queueDriverId ||
      null;

    const passenger = passengerById[passengerId] ?? null;
    const driver = currentDriverId
      ? driverById[currentDriverId] ?? null
      : null;

    const status = normalizeStatus(row?.status);

    return {
      id: row?.id ?? null,
      passenger_id: passengerId || null,
      passenger_name: passenger?.full_name || "Unknown Passenger",
      passenger_phone: passenger?.phone || null,
      passenger_email: passenger?.email || null,
      passenger_town_origin: passenger?.town_origin || null,

      pickup_town: row?.pickup_town ?? null,
      pickup_address: row?.pickup_address ?? null,
      destination_address: row?.destination_address ?? null,
      distance_km: row?.distance_km ?? null,
      vehicle_type: row?.vehicle_type ?? null,
      passenger_count: passengerCountFromNotes(row?.notes),
      notes: row?.notes ?? null,

      scheduled_pickup_at: row?.scheduled_pickup_at ?? null,
      booking_created_at: row?.booking_created_at ?? null,
      booking_expires_at: row?.booking_expires_at ?? null,
      updated_at: row?.updated_at ?? null,

      booking_mode: row?.booking_mode ?? null,
      fare_bracket: row?.fare_bracket ?? null,
      status,

      estimated_fare_min: row?.estimated_fare_min ?? null,
      estimated_fare_max: row?.estimated_fare_max ?? null,
      estimated_pickup_fee: row?.estimated_pickup_fee ?? null,
      estimated_total: row?.estimated_total ?? null,
      proposed_ride_fare: row?.proposed_ride_fare ?? null,
      proposed_platform_fee: row?.proposed_platform_fee ?? null,
      pickup_fee: row?.pickup_fee ?? null,
      total_fare: row?.total_fare ?? null,

      committed_driver_id: committedDriverId || null,
      current_driver_id: currentDriverId,
      current_driver_name:
        driver?.driver_name ||
        currentDriverId ||
        null,
      current_driver_status: driver?.driver_status || null,

      current_offer_queue_id: queueId || null,
      queue: queue
        ? {
            id: queue.id ?? null,
            driver_id: queueDriverId || null,
            status: queue.status ?? null,
            joined_at: queue.joined_at ?? null,
            removed_at: queue.removed_at ?? null,
            removal_reason: queue.removal_reason ?? null,
            stagger_position: queue.stagger_position ?? null,
            offer_sent_at: queue.offer_sent_at ?? null,
            offer_expires_at: queue.offer_expires_at ?? null,
            offer_minutes_remaining: minutesUntil(queue.offer_expires_at),
            fare_preparation_expires_at:
              queue.fare_preparation_expires_at ?? null,
            fare_preparation_minutes_remaining: minutesUntil(
              queue.fare_preparation_expires_at
            ),
            departure_option: queue.departure_option ?? null,
            departure_distance_km:
              queue.departure_distance_km ?? null,
            pickup_fee_computed:
              queue.pickup_fee_computed ?? null,
            fare_locked_total:
              queue.fare_locked_total ?? null,
            commitment_confirmed:
              queue.commitment_confirmed ?? false,
          }
        : null,

      passenger_response_expires_at:
        row?.passenger_response_expires_at ?? null,
      passenger_response_minutes_remaining: minutesUntil(
        row?.passenger_response_expires_at
      ),

      escalation_level: row?.escalation_level ?? 0,
      dispatcher_alerted_at: row?.dispatcher_alerted_at ?? null,
      total_offers_sent: row?.total_offers_sent ?? 0,
      total_passenger_declines:
        row?.total_passenger_declines ?? 0,

      committed_at: row?.committed_at ?? null,
      driver_reserved_at: row?.driver_reserved_at ?? null,
      driver_locked_at: row?.driver_locked_at ?? null,
      departure_option_used: row?.departure_option_used ?? null,

      live_booking_id: row?.live_booking_id ?? null,
      converted_at: row?.converted_at ?? null,

      cancelled_at: row?.cancelled_at ?? null,
      cancellation_reason: row?.cancellation_reason ?? null,
      cancelled_by: row?.cancelled_by ?? null,

      is_active: ACTIVE_STATUSES.has(status),
    };
  });

  const filtered = bookings.filter((booking) => {
    if (requestedFilter === "all") return true;
    if (requestedFilter === "active") return booking.is_active;
    if (requestedFilter === "cancelled") {
      return booking.status.startsWith("cancelled");
    }
    return booking.status === requestedFilter;
  });

  const counts: Record<string, number> = {
    all: bookings.length,
    active: bookings.filter((row) => row.is_active).length,
    open: bookings.filter((row) => row.status === "open").length,
    fare_proposed: bookings.filter(
      (row) => row.status === "fare_proposed"
    ).length,
    fare_accepted: bookings.filter(
      (row) => row.status === "fare_accepted"
    ).length,
    confirmed: bookings.filter(
      (row) => row.status === "confirmed"
    ).length,
    dispatcher_intervention: bookings.filter(
      (row) => row.status === "dispatcher_intervention"
    ).length,
    live: bookings.filter((row) => row.status === "live").length,
    completed: bookings.filter(
      (row) => row.status === "completed"
    ).length,
    cancelled: bookings.filter((row) =>
      row.status.startsWith("cancelled")
    ).length,
  };

  return json(200, {
    ok: true,
    source: "app/api/admin/advance-booking-dispatch/route.ts",
    filter: requestedFilter,
    counts,
    bookings: filtered,
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireStaff();

  if (!gate.ok) {
    return json(403, {
      ok: false,
      error: "FORBIDDEN",
      message: "Forbidden",
    });
  }

  const admin = getAdmin();

  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing Supabase service role configuration.",
    });
  }

  const body = await req.json().catch(() => ({}));
  const action = normalizeStatus(body?.action);
  const advanceBookingId = text(body?.advanceBookingId);
  const cancellationReason = text(body?.cancellationReason);

  console.log("[AB Dispatcher] POST body", {
    action,
    advanceBookingId,
    cancellationReason,
  });

  if (action !== "cancel_booking") {
    return json(400, {
      ok: false,
      error: "INVALID_ACTION",
      message: "Unsupported dispatcher action.",
    });
  }

  if (!advanceBookingId) {
    return json(400, {
      ok: false,
      error: "MISSING_BOOKING_ID",
      message: "advanceBookingId is required.",
    });
  }

  if (!cancellationReason) {
    return json(400, {
      ok: false,
      error: "MISSING_REASON",
      message: "A cancellation reason is required.",
    });
  }

  const { data, error } = await admin.rpc(
    "dispatcher_cancel_advance_booking",
    {
      p_advance_booking_id: advanceBookingId,
      p_cancellation_reason: cancellationReason,
    }
  );

  console.log("[AB Dispatcher] RPC result", {
    data,
    error,
  });

  if (error) {
    console.error("[AB Dispatcher] RPC ERROR", error);
    console.error(
      "[advance-booking-dispatch:cancel:rpc]",
      error
    );

    return json(500, {
      ok: false,
      error: "RPC_FAILED",
      message: error.message,
    });
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    message?: string;
    currentStatus?: string;
    advanceBookingId?: string;
    previousStatus?: string;
    cancelledStatus?: string;
    releasedQueueCount?: number;
  };

  if (!result.ok) {
    console.log("[AB Dispatcher] FAILURE", result);

    const status =
      result.error === "BOOKING_NOT_FOUND"
        ? 404
        : result.error === "MISSING_REASON"
          ? 400
          : result.error === "INTERNAL_ERROR"
            ? 500
            : 409;

    return json(status, {
      ok: false,
      error: result.error || "CANCELLATION_FAILED",
      message:
        result.message ||
        "Advance booking cancellation failed.",
      currentStatus: result.currentStatus ?? null,
    });
  }

  console.log("[AB Dispatcher] SUCCESS", result);

  return json(200, {
    ok: true,
    action: "cancel_booking",
    advanceBookingId:
      result.advanceBookingId || advanceBookingId,
    previousStatus: result.previousStatus ?? null,
    cancelledStatus:
      result.cancelledStatus || "cancelled_dispatcher",
    releasedQueueCount:
      Number(result.releasedQueueCount ?? 0),
  });
}
