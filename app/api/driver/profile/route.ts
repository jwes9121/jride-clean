import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

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

function effectiveMinWalletRequired(raw: unknown): number {
  const configured = num(raw);
  if (configured !== null && configured >= 250) return configured;
  return 250;
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

async function resolveDriverIdentity(req: NextRequest) {
  const supabase = getSupabase();

  const auth = text(req.headers.get("authorization"));
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user?.id) {
        const userId = data.user.id;

        const { data: dp } = await supabase
          .from("driver_profiles")
          .select("driver_id, full_name, municipality, phone, email, photo_url")
          .eq("driver_id", userId)
          .maybeSingle();

        if (dp?.driver_id) {
          return {
            ok: true as const,
            driverId: text(dp.driver_id),
            profileHint: dp,
          };
        }

        const email = text(data.user.email);
        if (email) {
          const { data: byEmail } = await supabase
            .from("driver_profiles")
            .select("driver_id, full_name, municipality, phone, email, photo_url")
            .eq("email", email)
            .maybeSingle();

          if (byEmail?.driver_id) {
            return {
              ok: true as const,
              driverId: text(byEmail.driver_id),
              profileHint: byEmail,
            };
          }
        }
      }
    }
  }

  const secret = text(req.headers.get("x-jride-driver-secret"));
  const expectedSecret = text(
    process.env.DRIVER_PING_SECRET || process.env.NEXT_PUBLIC_DRIVER_PING_SECRET
  );
  const driverId = text(req.nextUrl.searchParams.get("driver_id"));

  if (driverId && secret && expectedSecret && secret === expectedSecret) {
    return {
      ok: true as const,
      driverId,
      profileHint: null,
    };
  }

  return {
    ok: false as const,
    error: "NOT_AUTHED",
    message: "Missing valid driver auth.",
  };
}

function buildTripSummary(row: any) {
  const verifiedFare = num(row?.verified_fare);
  const proposedFare = num(row?.proposed_fare);
  const pickupDistanceFee = num(row?.pickup_distance_fee) ?? 0;
  const totalFare = (verifiedFare ?? proposedFare ?? 0) + pickupDistanceFee;

  return {
    id: text(row?.id) || null,
    booking_code: text(row?.booking_code) || null,
    status: text(row?.status) || null,
    town: text(row?.town) || null,
    pickup_label: text(row?.from_label) || null,
    dropoff_label: text(row?.to_label) || null,
    driver_id: text(row?.driver_id) || null,
    assigned_driver_id: text(row?.assigned_driver_id) || null,
    passenger_name: text(row?.passenger_name) || null,
    proposed_fare: proposedFare,
    verified_fare: verifiedFare,
    pickup_distance_fee: pickupDistanceFee,
    total_fare: totalFare,
    created_at: text(row?.created_at) || null,
    updated_at: text(row?.updated_at) || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const authRes = await resolveDriverIdentity(req);
    if (!authRes.ok) {
      return NextResponse.json(authRes, {
        status: 401,
        headers: noStoreHeaders(),
      });
    }

    const supabase = getSupabase();

    let profileRow: any = authRes.profileHint ?? null;
    if (!profileRow) {
      try {
        const { data } = await supabase
          .from("driver_profiles")
          .select("driver_id, full_name, municipality, phone, email, photo_url")
          .eq("driver_id", authRes.driverId)
          .maybeSingle();

        profileRow = data ?? null;
      } catch {
        profileRow = null;
      }
    }

    let wallet: any = null;
    try {
      const { data } = await supabase
        .from("drivers")
        .select("id, wallet_balance, min_wallet_required, wallet_locked, driver_name")
        .eq("id", authRes.driverId)
        .maybeSingle();

      wallet = data ?? null;
    } catch {
      wallet = null;
    }

    const walletBalance = num(wallet?.wallet_balance) ?? 0;
    const walletMinRequired = effectiveMinWalletRequired(wallet?.min_wallet_required);
    const walletLocked = Boolean(wallet?.wallet_locked);
    const walletStatus = walletLocked
      ? "LOCKED"
      : walletBalance < walletMinRequired
      ? "LOW"
      : "OK";

    const { data: tripRows, error: tripErr } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, status, town, from_label, to_label, passenger_name, proposed_fare, verified_fare, pickup_distance_fee, created_at, updated_at, driver_id, assigned_driver_id"
      )
      .or(`driver_id.eq.${authRes.driverId},assigned_driver_id.eq.${authRes.driverId}`)
      .order("created_at", { ascending: false })
      .limit(10);

    if (tripErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_TRIP_HISTORY_READ_FAILED",
          message: tripErr.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        profile: {
          driver_id: authRes.driverId,
          full_name:
            text(profileRow?.full_name) ||
            text(wallet?.driver_name) ||
            null,
          town: text(profileRow?.municipality) || null,
          phone: text(profileRow?.phone) || null,
          email: text(profileRow?.email) || null,
	  driver_photo_url: text(profileRow?.photo_url) || null,
          wallet_balance: walletBalance,
          wallet_min_required: walletMinRequired,
          wallet_locked: walletLocked,
          wallet_status: walletStatus,
          wallet_source: "drivers.wallet_balance",
        },
        recent_trips: (tripRows || []).map(buildTripSummary),
      },
      { headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "DRIVER_PROFILE_FAILED", message: e?.message || "Unexpected server error." },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
export async function POST(req: NextRequest) {
  try {
    const authRes = await resolveDriverIdentity(req);
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
        { ok: false, error: "PHOTO_REQUIRED", message: "Missing photo file." },
        { status: 400, headers: noStoreHeaders() }
      );
    }

        const contentType = String(file.type || "").toLowerCase();
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

    if (!allowed.has(contentType)) {
      return NextResponse.json(
        { ok: false, error: "PHOTO_TYPE_NOT_ALLOWED", message: "Use JPG, PNG, or WEBP." },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const maxInputBytes = 10 * 1024 * 1024;
    if (file.size > maxInputBytes) {
      return NextResponse.json(
        { ok: false, error: "PHOTO_TOO_LARGE", message: "Photo must be 10MB or smaller." },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    let bytes: Buffer;
    try {
      const inputBytes = Buffer.from(await file.arrayBuffer());

      bytes = await sharp(inputBytes, { failOn: "none" })
        .rotate()
        .resize({
          width: 512,
          height: 512,
          fit: "cover",
          position: "centre",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      return NextResponse.json(
        { ok: false, error: "PHOTO_PROCESSING_FAILED", message: "Could not process uploaded photo." },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const supabase = getSupabase();
    const storagePath = `drivers/${authRes.driverId}/profile.webp`;

    const uploadRes = await supabase.storage
      .from("driver-assets")
      .upload(storagePath, bytes, {
        contentType: "image/webp",
        upsert: true,
      });

    if (uploadRes.error) {
      return NextResponse.json(
        { ok: false, error: "PHOTO_UPLOAD_FAILED", message: uploadRes.error.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const { data: publicUrlData } = supabase.storage
      .from("driver-assets")
      .getPublicUrl(storagePath);

    const photoUrl = text(publicUrlData?.publicUrl);

    if (!photoUrl) {
      return NextResponse.json(
        { ok: false, error: "PHOTO_PUBLIC_URL_FAILED", message: "Could not create public URL." },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const updateRes = await supabase
      .from("driver_profiles")
      .update({ photo_url: photoUrl })
      .eq("driver_id", authRes.driverId)
      .select("driver_id, photo_url")
      .maybeSingle();

    if (updateRes.error) {
      return NextResponse.json(
        { ok: false, error: "PHOTO_PROFILE_UPDATE_FAILED", message: updateRes.error.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        driver_id: authRes.driverId,
        driver_photo_url: text(updateRes.data?.photo_url) || photoUrl,
      },
      { headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "DRIVER_PHOTO_UPLOAD_FAILED", message: e?.message || "Unexpected server error." },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
