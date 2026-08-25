import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { resolvePassengerBookingIdentity } from "@/lib/passenger/bookingIdentity";
function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function getSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolvePassengerFromBearer(req: NextRequest) {
  const auth = text(req.headers.get("authorization"));
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false as const,
      error: "NOT_AUTHED",
      message: "Missing bearer token.",
    };
  }

  const token = auth.slice(7).trim();
  if (!token) {
    return {
      ok: false as const,
      error: "NOT_AUTHED",
      message: "Missing bearer token.",
    };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user?.id) {
    return {
      ok: false as const,
      error: "NOT_AUTHED",
      message: error?.message || "Invalid bearer token.",
    };
  }

  return {
    ok: true as const,
    userId: data.user.id,
    email: text(data.user.email),
    phone: text((data.user as any)?.phone),
  };
}

function buildTripSummary(row: any, driverNameById: Record<string, string>) {
  const verifiedFare = num(row?.verified_fare);
  const proposedFare = num(row?.proposed_fare);
  const pickupDistanceFee = num(row?.pickup_distance_fee) ?? 0;
  const platformFee = null;
  const totalFare = (verifiedFare ?? proposedFare ?? 0) + pickupDistanceFee;

  const assignedDriverId = text(row?.assigned_driver_id);
  const resolvedDriverName =
    assignedDriverId && driverNameById[assignedDriverId]
      ? driverNameById[assignedDriverId]
      : null;

  return {
    id: text(row?.id) || null,
    booking_code: text(row?.booking_code) || null,
    status: text(row?.status) || null,
    town: text(row?.town) || null,
    pickup_label: text(row?.from_label) || null,
    dropoff_label: text(row?.to_label) || null,
    driver_name: resolvedDriverName,
    passenger_name: text(row?.passenger_name) || null,
    proposed_fare: proposedFare,
    verified_fare: verifiedFare,
    pickup_distance_fee: pickupDistanceFee,
    platform_fee: platformFee,
    total_fare: totalFare,
    created_at: text(row?.created_at) || null,
    updated_at: text(row?.updated_at) || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const authRes = await resolvePassengerFromBearer(req);
    if (!authRes.ok) {
      return NextResponse.json(authRes, {
        status: 401,
        headers: noStoreHeaders(),
      });
    }

    const supabase = getSupabase();

    let profile: any = null;
    let savedAddressCount = 0;

    const bookingIdentity = await resolvePassengerBookingIdentity(
      supabase,
      authRes.userId
    );
    try {
      const { data } = await supabase
        .from("passenger_profiles")
        .select("user_id, full_name, phone, email, photo_url")
        .eq("user_id", authRes.userId)
        .limit(1);

      profile = data?.[0] ?? null;
    } catch {
      profile = null;
    }

    try {
      const { data } = await supabase
        .from("passenger_addresses")
        .select("id")
        .eq("created_by_user_id", authRes.userId)
        .eq("is_active", true);

      savedAddressCount = Array.isArray(data) ? data.length : 0;
    } catch {
      savedAddressCount = 0;
    }

    const { data: tripRows, error: tripErr } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, status, town, from_label, to_label, assigned_driver_id, passenger_name, proposed_fare, verified_fare, pickup_distance_fee, created_at, updated_at"
      )
      .eq("created_by_user_id", authRes.userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (tripErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "TRIP_HISTORY_READ_FAILED",
          message: tripErr.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const driverIds = Array.from(
      new Set(
        (tripRows ?? [])
          .map((row: any) => text(row?.assigned_driver_id))
          .filter((v): v is string => Boolean(v))
      )
    );

    let driverNameById: Record<string, string> = {};

    if (driverIds.length > 0) {
      try {
        const { data: driverRows } = await supabase
          .from("driver_profiles")
          .select("driver_id, full_name")
          .in("driver_id", driverIds);

        for (const row of driverRows ?? []) {
          const id = text((row as any)?.driver_id);
          const name = text((row as any)?.full_name);
          if (id && name) {
            driverNameById[id] = name;
          }
        }
      } catch {
        driverNameById = {};
      }
    }

    return NextResponse.json(
      {
        ok: true,
        profile: {
          user_id: authRes.userId,
          full_name: text(profile?.full_name) || null,
          booking_name: bookingIdentity.name,
          booking_name_source: bookingIdentity.source,
          phone: text(profile?.phone) || authRes.phone || null,
          email: text(profile?.email) || authRes.email || null,
          photo_url: text(profile?.photo_url) || null,
          passenger_photo_url: text(profile?.photo_url) || null,
          saved_address_count: savedAddressCount,
        },
        recent_trips: (tripRows ?? []).map((row: any) =>
          buildTripSummary(row, driverNameById)
        ),
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "PASSENGER_PROFILE_ROUTE_FAILED",
        message: String(err?.message ?? err),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
export async function POST(req: NextRequest) {
  try {
    const authRes = await resolvePassengerFromBearer(req);

    if (!authRes.ok) {
      return NextResponse.json(authRes, {
        status: 401,
        headers: noStoreHeaders(),
      });
    }

    const form = await req.formData();
    const file = form.get("photo");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_REQUIRED",
          message: "Missing photo file.",
        },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const contentType = text(file.type).toLowerCase();
    const allowedTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);

    if (!allowedTypes.has(contentType)) {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_TYPE_NOT_ALLOWED",
          message: "Use JPG, PNG, or WEBP.",
        },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    // Large normal phone photos are accepted and resized automatically.
    // The hard limit protects server memory from abusive or malformed input.
    const maxInputBytes = 20 * 1024 * 1024;

    if (file.size <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_EMPTY",
          message: "The selected photo is empty.",
        },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (file.size > maxInputBytes) {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_TOO_LARGE",
          message: "Photo must be 20MB or smaller.",
        },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    let processedBytes: Buffer;

    try {
      const inputBytes = Buffer.from(await file.arrayBuffer());

      processedBytes = await sharp(inputBytes, {
        failOn: "none",
        limitInputPixels: 10000 * 10000,
      })
        .rotate()
        .resize({
          width: 512,
          height: 512,
          fit: "cover",
          position: "centre",
          withoutEnlargement: true,
        })
        .webp({
          quality: 82,
          effort: 4,
        })
        .toBuffer();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_PROCESSING_FAILED",
          message: "Could not process the uploaded photo.",
        },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (processedBytes.length <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_PROCESSING_EMPTY",
          message: "The processed photo is empty.",
        },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const maxStoredBytes = 1024 * 1024;

    if (processedBytes.length > maxStoredBytes) {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_PROCESSED_TOO_LARGE",
          message: "The processed photo exceeds the storage limit.",
        },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const supabase = getSupabase();
    const storagePath =
      `profiles/${authRes.userId}/avatar.webp`;

    const uploadRes = await supabase.storage
      .from("passenger-assets")
      .upload(storagePath, processedBytes, {
        contentType: "image/webp",
        upsert: true,
        cacheControl: "3600",
      });

    if (uploadRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_UPLOAD_FAILED",
          message: uploadRes.error.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const { data: publicUrlData } = supabase.storage
      .from("passenger-assets")
      .getPublicUrl(storagePath);

    const basePhotoUrl = text(publicUrlData?.publicUrl);
    const photoUrl = basePhotoUrl
      ? `${basePhotoUrl}?v=${Date.now()}`
      : "";

    if (!photoUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_PUBLIC_URL_FAILED",
          message: "Could not create the passenger photo URL.",
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const updateRes = await supabase
      .from("passenger_profiles")
      .update({
        photo_url: photoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", authRes.userId)
      .select("user_id, photo_url")
      .maybeSingle();

    if (updateRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "PHOTO_PROFILE_UPDATE_FAILED",
          message: updateRes.error.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    if (!updateRes.data?.user_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "PASSENGER_PROFILE_NOT_FOUND",
          message: "Passenger profile row was not found.",
        },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        passenger_id: authRes.userId,
        photo_url: text(updateRes.data.photo_url) || photoUrl,
        passenger_photo_url:
          text(updateRes.data.photo_url) || photoUrl,
        processed: {
          width: 512,
          height: 512,
          format: "webp",
          bytes: processedBytes.length,
        },
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "PASSENGER_PHOTO_UPLOAD_FAILED",
        message: String(err?.message ?? err),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}