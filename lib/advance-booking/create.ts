import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tripDistanceKm } from "./distance";
import { offerAdvanceBooking } from "./offer";
import { estimateFare } from "./pricing";
import { scheduleAdvanceBookingReminders } from "./reminders";
import {
  computeBookingExpiresAt,
  validateBookingWindow,
  validateCoordinates,
  validateRequiredStrings,
  validateVehicleType,
} from "./validation";
import type {
  AdvanceBookingCreateInput,
  AdvanceBookingCreateResult,
  AdvanceBookingError,
  VehicleType,
} from "./types";

type ExistingAdvanceBooking = {
  id: string;
  status: string;
  scheduledPickupAt: string;
  pickupAddress: string;
  destinationAddress: string;
  vehicleType: string;
};

type CreateFailure = {
  ok: false;
  error: AdvanceBookingError;
  message: string;
  status: number;
  existingBooking?: ExistingAdvanceBooking;
};

type CreateSuccess = AdvanceBookingCreateResult & {
  ok: true;
  advanceBookingId: string;
  bookingMode: "daytime" | "night";
  fareBracket: "normal" | "double" | "late_night";
  scheduledPickupAt: string;
  status: "open";
  reminderJobsCreated: number;
  offersCreated: number;
};

export type CreateAdvanceBookingResult = CreateSuccess | CreateFailure;

function fail(
  error: AdvanceBookingError,
  message: string,
  status = 400
): CreateFailure {
  return { ok: false, error, message, status };
}

function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return Number.NaN;
}

function coalesceVerifiedAt(row: any): string | null {
  return (
    row?.admin_reviewed_at ||
    row?.dispatcher_reviewed_at ||
    row?.updated_at ||
    row?.created_at ||
    null
  );
}

async function getPassengerVerifiedAt(
  passengerId: string
): Promise<{ ok: true; verifiedAt: string } | { ok: false; message: string }> {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("passenger_verifications")
    .select("admin_reviewed_at, dispatcher_reviewed_at, updated_at, created_at")
    .eq("user_id", passengerId)
    .eq("status", "approved_admin")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message };
  }

  const verifiedAt = coalesceVerifiedAt(data);

  if (!verifiedAt) {
    return { ok: false, message: "Passenger verification required." };
  }

  return { ok: true, verifiedAt };
}

export async function createAdvanceBooking(
  input: AdvanceBookingCreateInput
): Promise<CreateAdvanceBookingResult> {
  const passengerId = String(input?.passengerId || "").trim();
  const requestedTown = String(input?.town || "").trim();
  const pickupAddress = String(input?.pickupAddress || "").trim();
  const destinationAddress = String(input?.destinationAddress || "").trim();
  const notes =
    typeof input?.notes === "string" && input.notes.trim()
      ? input.notes.trim()
      : null;

  const pickupLat = num(input?.pickupLat);
  const pickupLng = num(input?.pickupLng);
  const destinationLat = num(input?.destinationLat);
  const destinationLng = num(input?.destinationLng);
  const vehicleType = String(input?.vehicleType || "").trim() as VehicleType;
  const scheduledPickupAt = new Date(String(input?.scheduledPickupAt || ""));

  const required = validateRequiredStrings({
    passengerId,
    pickupAddress,
    destinationAddress,
    scheduledPickupAt: input?.scheduledPickupAt,
  });

  if (!required.ok) {
    return fail(
      required.error || "MISSING_PARAMS",
      required.message || "Missing required fields.",
      400
    );
  }

  if (!requestedTown) {
    return fail("MISSING_PARAMS", "Town is required.", 400);
  }

  const vehicle = validateVehicleType(vehicleType);
  if (!vehicle.ok) {
    return fail(
      vehicle.error || "MISSING_PARAMS",
      vehicle.message || "Invalid vehicle type.",
      400
    );
  }

  const pickupCoords = validateCoordinates(pickupLat, pickupLng, "pickup");
  if (!pickupCoords.ok) {
    return fail(
      pickupCoords.error || "INVALID_COORDINATES",
      pickupCoords.message || "Invalid pickup coordinates.",
      400
    );
  }

  const destinationCoords = validateCoordinates(
    destinationLat,
    destinationLng,
    "destination"
  );

  if (!destinationCoords.ok) {
    return fail(
      destinationCoords.error || "INVALID_COORDINATES",
      destinationCoords.message || "Invalid destination coordinates.",
      400
    );
  }

  const windowCheck = validateBookingWindow(scheduledPickupAt);
  if (!windowCheck.ok) {
    return fail(
      windowCheck.error || "INVALID_SCHEDULED_TIME",
      windowCheck.message || "Invalid scheduled pickup time.",
      400
    );
  }

  const verified = await getPassengerVerifiedAt(passengerId);
  if (!verified.ok) {
    return fail("PASSENGER_NOT_VERIFIED", verified.message, 403);
  }

  const distanceKm = tripDistanceKm(
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng
  );

  const estimate = estimateFare(distanceKm, scheduledPickupAt, 0);
  const bookingExpiresAt = computeBookingExpiresAt(scheduledPickupAt);

  const supabase = supabaseAdmin();

  const { data: zoneRows, error: zoneError } = await supabase
    .from("zones")
    .select("zone_name")
    .limit(100);

  if (zoneError) {
    return fail("DATABASE_ERROR", zoneError.message, 500);
  }

  const canonicalTown = (zoneRows ?? [])
    .map((row) => String(row.zone_name || "").trim())
    .find(
      (zoneName) =>
        zoneName.toLowerCase() === requestedTown.toLowerCase()
    );

  if (!canonicalTown) {
    return fail("MISSING_PARAMS", "Selected town is not supported.", 400);
  }

  const insertRow: Record<string, any> = {
    passenger_id: passengerId,
    passenger_verified_at: verified.verifiedAt,
    pickup_town: canonicalTown,

    pickup_address: pickupAddress,
    pickup_lat: pickupLat,
    pickup_lng: pickupLng,

    destination_address: destinationAddress,
    destination_lat: destinationLat,
    destination_lng: destinationLng,

    distance_km: distanceKm,
    vehicle_type: vehicleType,
    notes,

    scheduled_pickup_at: scheduledPickupAt.toISOString(),
    booking_expires_at: bookingExpiresAt.toISOString(),

    booking_mode: estimate.bookingMode,
    fare_bracket: estimate.fareBracket,

    estimated_fare_min: estimate.total,
    estimated_fare_max: estimate.total,
    estimated_pickup_fee: estimate.pickupFee,
    estimated_total: estimate.total,

    status: "open",
  };

  const { data: createData, error: createError } = await supabase.rpc(
    "create_advance_booking_if_no_active",
    {
      p_passenger_id: passengerId,
      p_booking_row: insertRow,
    }
  );

  if (createError) {
    return fail("DATABASE_ERROR", createError.message, 500);
  }

  const createResult = createData as
    | {
        ok?: boolean;
        created?: boolean;
        error?: string;
        message?: string;
        booking?: {
          id?: string;
          status?: string;
          scheduled_pickup_at?: string;
          pickup_address?: string;
          destination_address?: string;
          vehicle_type?: string;
          booking_mode?: "daytime" | "night";
          fare_bracket?: "normal" | "double" | "late_night";
        };
      }
    | null;

  if (!createResult?.ok) {
    return fail(
      "DATABASE_ERROR",
      createResult?.message ||
        createResult?.error ||
        "Failed to create advance booking.",
      500
    );
  }

  const bookingRow = createResult.booking;

  if (!createResult.created) {
    return {
      ok: false,
      error: "ACTIVE_ADVANCE_BOOKING_EXISTS",
      message:
        "You already have an active advance booking. Open it before scheduling another ride.",
      status: 409,
      existingBooking: {
        id: String(bookingRow?.id || ""),
        status: String(bookingRow?.status || ""),
        scheduledPickupAt: String(bookingRow?.scheduled_pickup_at || ""),
        pickupAddress: String(bookingRow?.pickup_address || ""),
        destinationAddress: String(bookingRow?.destination_address || ""),
        vehicleType: String(bookingRow?.vehicle_type || ""),
      },
    };
  }

  const created = {
    id: String(bookingRow?.id || ""),
    booking_mode: bookingRow?.booking_mode,
    fare_bracket: bookingRow?.fare_bracket,
    scheduled_pickup_at: bookingRow?.scheduled_pickup_at,
    status: bookingRow?.status,
  };

  if (
    !created.id ||
    !created.booking_mode ||
    !created.fare_bracket ||
    !created.scheduled_pickup_at ||
    created.status !== "open"
  ) {
    return fail(
      "DATABASE_ERROR",
      "Advance booking was created but the returned row was incomplete.",
      500
    );
  }

  const reminders = await scheduleAdvanceBookingReminders({
    advanceBookingId: String(created.id),
    passengerId,
    driverId: null,
    scheduledPickupAt,
    bookingMode: created.booking_mode,
  });

  if (!reminders.ok) {
    return fail(
      "DATABASE_ERROR",
      `Advance booking was created but reminders failed: ${reminders.error}`,
      500
    );
  }

  const offers = await offerAdvanceBooking({
    advanceBookingId: String(created.id),
    pickupLat,
    pickupLng,
    pickupTown: canonicalTown,
    vehicleType,
    scheduledPickupAt,
  });

  if (!offers.ok) {
    console.error("[advance-booking:create] offer failed", offers.error);
  } else if (offers.offersCreated === 0) {
    console.warn("[advance-booking:create] no eligible drivers found", {
      bookingId: created.id,
      pickupTown: canonicalTown,
      vehicleType,
      scheduledPickupAt: scheduledPickupAt.toISOString(),
    });
  } else if (offers.offersCreated === 0) {
    console.warn("[advance-booking:create] no eligible drivers found", {
      bookingId: created.id,
      pickupTown: canonicalTown,
      vehicleType,
      scheduledPickupAt: scheduledPickupAt.toISOString(),
    });
  }

  return {
    ok: true,
    advanceBookingId: String(created.id),
    bookingMode: created.booking_mode,
    fareBracket: created.fare_bracket,
    scheduledPickupAt: String(created.scheduled_pickup_at),
    status: "open",
    reminderJobsCreated: reminders.created,
    offersCreated: offers.ok ? offers.offersCreated : 0,
  };
}