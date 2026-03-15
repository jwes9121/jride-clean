import { supabaseAdmin } from "@/lib/supabaseAdmin";

type BookingRow = {
  id?: string | null;
  booking_code?: string | null;
  town?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  status?: string | null;
  driver_id?: string | null;
  assigned_driver_id?: string | null;
  assigned_at?: string | null;
  updated_at?: string | null;
};

type DriverLocationRow = {
  driver_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  status?: string | null;
  town?: string | null;
  updated_at?: string | null;
};

type DriverMasterRow = {
  id?: string | null;
  driver_name?: string | null;
  driver_status?: string | null;
  zone_id?: string | null;
  toda_name?: string | null;
};

type DriverProfileRow = {
  driver_id?: string | null;
  full_name?: string | null;
  phone?: string | null;
};

type OfferRow = {
  id?: string | null;
  booking_id?: string | null;
  booking_code?: string | null;
  driver_id?: string | null;
  offer_rank?: number | null;
  status?: string | null;
  offered_at?: string | null;
  expires_at?: string | null;
  responded_at?: string | null;
  response_source?: string | null;
  source?: string | null;
  town?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  score?: number | null;
  note?: string | null;
};

type Candidate = {
  driver_id: string;
  name: string | null;
  phone: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
  age_seconds: number | null;
  assign_eligible: boolean;
  score: number;
};

function asNum(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ageSecondsFromIso(input: string | null | undefined) {
  if (!input) return null;
  const ms = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 1000));
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const sa = Math.sin(dLat / 2);
  const sb = Math.sin(dLng / 2);
  const c =
    2 *
    Math.atan2(
      Math.sqrt(
        sa * sa +
          Math.cos((aLat * Math.PI) / 180) *
            Math.cos((bLat * Math.PI) / 180) *
            sb * sb
      ),
      Math.sqrt(1 - sa * sa)
    );
  return R * c;
}

function isLockedStatus(s: string) {
  const x = String(s || "").toLowerCase().trim();
  return x === "on_trip" || x === "completed" || x === "cancelled";
}

function isAssignableBookingStatus(s: string) {
  const x = String(s || "").toLowerCase().trim();
  return x === "requested" || x === "pending" || x === "assigned";
}

export async function resolveBooking(args: {
  bookingId?: string | null;
  bookingCode?: string | null;
}) {
  const supabase = supabaseAdmin();
  const bookingId = String(args.bookingId || "").trim();
  const bookingCode = String(args.bookingCode || "").trim();

  if (!bookingId && !bookingCode) {
    throw new Error("MISSING_BOOKING_IDENTIFIER");
  }

  let q = supabase
    .from("bookings")
    .select("id,booking_code,town,pickup_lat,pickup_lng,status,driver_id,assigned_driver_id,assigned_at,updated_at")
    .limit(1);

  if (bookingId) q = q.eq("id", bookingId);
  else q = q.eq("booking_code", bookingCode);

  const { data, error } = await q;
  if (error) throw new Error("BOOKING_READ_ERROR: " + error.message);

  const row = Array.isArray(data) ? (data[0] as BookingRow) : null;
  if (!row?.id) throw new Error("BOOKING_NOT_FOUND");

  return row;
}

export async function listOffersForBooking(bookingId: string) {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("dispatch_driver_offers")
    .select("*")
    .eq("booking_id", bookingId)
    .order("offer_rank", { ascending: true });

  if (error) throw new Error("OFFERS_READ_ERROR: " + error.message);
  return Array.isArray(data) ? (data as OfferRow[]) : [];
}

export async function getOpenOfferForBooking(bookingId: string) {
  const offers = await listOffersForBooking(bookingId);
  const now = Date.now();

  for (let i = offers.length - 1; i >= 0; i--) {
    const o = offers[i];
    if (String(o.status || "") !== "offered") continue;
    const exp = new Date(String(o.expires_at || "")).getTime();
    if (Number.isFinite(exp) && exp > now) return o;
  }

  return null;
}

export async function buildCandidates(args: {
  booking: BookingRow;
  excludedDriverIds?: string[];
  freshMinutes?: number;
}) {
  const supabase = supabaseAdmin();
  const excluded = new Set((args.excludedDriverIds || []).map((x) => String(x || "").trim()).filter(Boolean));
  const freshMinutes = Number(args.freshMinutes || 10);
  const freshSeconds = freshMinutes * 60;
  const onlineLike = new Set(["online", "available", "idle", "waiting"]);

  const { data: locData, error: locErr } = await supabase
    .from("driver_locations")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (locErr) throw new Error("DRIVER_LOCATIONS_READ_ERROR: " + locErr.message);

  const locations = Array.isArray(locData) ? (locData as DriverLocationRow[]) : [];

  const dedupByDriver: Record<string, DriverLocationRow> = {};
  for (const row of locations) {
    const driverId = String(row.driver_id || "").trim();
    if (!driverId) continue;
    if (!dedupByDriver[driverId]) dedupByDriver[driverId] = row;
  }

  const driverIds = Object.keys(dedupByDriver);

  let mastersById: Record<string, DriverMasterRow> = {};
  let profilesByDriverId: Record<string, DriverProfileRow> = {};

  if (driverIds.length > 0) {
    const { data: mastersData, error: mastersErr } = await supabase
      .from("drivers")
      .select("id,driver_name,driver_status,zone_id,toda_name")
      .in("id", driverIds);

    if (mastersErr) throw new Error("DRIVERS_READ_ERROR: " + mastersErr.message);

    const masters = Array.isArray(mastersData) ? (mastersData as DriverMasterRow[]) : [];
    mastersById = Object.fromEntries(masters.map((m) => [String(m.id || ""), m]));

    const { data: profilesData, error: profilesErr } = await supabase
      .from("driver_profiles")
      .select("driver_id,full_name,phone")
      .in("driver_id", driverIds);

    if (profilesErr) throw new Error("DRIVER_PROFILES_READ_ERROR: " + profilesErr.message);

    const profiles = Array.isArray(profilesData) ? (profilesData as DriverProfileRow[]) : [];
    profilesByDriverId = Object.fromEntries(profiles.map((p) => [String(p.driver_id || ""), p]));
  }

  const pickupLat = asNum(args.booking.pickup_lat);
  const pickupLng = asNum(args.booking.pickup_lng);
  const bookingTown = String(args.booking.town || "").trim().toLowerCase();

  const candidates: Candidate[] = [];

  for (const driverId of driverIds) {
    if (excluded.has(driverId)) continue;

    const loc = dedupByDriver[driverId];
    const rawStatus = String(loc.status || "").trim().toLowerCase();
    const ageSeconds = ageSecondsFromIso(loc.updated_at);
    const isFresh = ageSeconds != null && ageSeconds <= freshSeconds;
    const isOnline = onlineLike.has(rawStatus);
    const lat = asNum(loc.lat);
    const lng = asNum(loc.lng);

    if (!isFresh) continue;
    if (!isOnline) continue;
    if (lat == null || lng == null) continue;

    const master = mastersById[driverId] || null;
    const profile = profilesByDriverId[driverId] || null;

    let score = 999999999;

    if (pickupLat != null && pickupLng != null) {
      score = distanceMeters(pickupLat, pickupLng, lat, lng);
    }

    const driverTown = String(loc.town || "").trim().toLowerCase();
    if (bookingTown && driverTown && bookingTown !== driverTown) {
      score += 2000;
    }

    if (ageSeconds != null) {
      score += Math.floor(ageSeconds / 10);
    }

    candidates.push({
      driver_id: driverId,
      name: master?.driver_name ?? profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      town: loc.town ?? null,
      lat,
      lng,
      updated_at: loc.updated_at ?? null,
      age_seconds: ageSeconds,
      assign_eligible: true,
      score
    });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

export async function createNextOffer(args: {
  bookingId?: string | null;
  bookingCode?: string | null;
  timeoutSeconds?: number;
  source?: string | null;
}) {
  const supabase = supabaseAdmin();
  const timeoutSeconds = Number(args.timeoutSeconds || 8);
  const source = String(args.source || "queue").trim();

  const booking = await resolveBooking(args);
  const bookingId = String(booking.id || "");
  const bookingCode = String(booking.booking_code || "");
  const currentStatus = String(booking.status || "");

  if (isLockedStatus(currentStatus)) {
    return {
      ok: false,
      error: "BOOKING_LOCKED",
      message: "Booking is locked for offers when status=" + currentStatus
    };
  }

  if (!isAssignableBookingStatus(currentStatus)) {
    return {
      ok: false,
      error: "BOOKING_NOT_ASSIGNABLE",
      message: "Booking is not assignable when status=" + currentStatus
    };
  }

  const openOffer = await getOpenOfferForBooking(bookingId);
  if (openOffer?.id) {
    return {
      ok: true,
      reused_open_offer: true,
      offer: openOffer
    };
  }

  const priorOffers = await listOffersForBooking(bookingId);
  const excludedDriverIds = Array.from(
    new Set(
      priorOffers
        .map((o) => String(o.driver_id || "").trim())
        .filter(Boolean)
    )
  );

  const candidates = await buildCandidates({
    booking,
    excludedDriverIds,
    freshMinutes: 10
  });

  if (!candidates.length) {
    return {
      ok: false,
      error: "NO_ELIGIBLE_DRIVERS",
      bookingId,
      bookingCode
    };
  }

  const nextRank = priorOffers.length + 1;
  const candidate = candidates[0];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000).toISOString();

  const insertBody = {
    booking_id: bookingId,
    booking_code: bookingCode,
    driver_id: candidate.driver_id,
    offer_rank: nextRank,
    status: "offered",
    offered_at: now.toISOString(),
    expires_at: expiresAt,
    source,
    town: booking.town ?? null,
    pickup_lat: booking.pickup_lat ?? null,
    pickup_lng: booking.pickup_lng ?? null,
    score: candidate.score,
    note: null
  };

  const { data: insData, error: insErr } = await supabase
    .from("dispatch_driver_offers")
    .insert(insertBody)
    .select("*")
    .limit(1);

  if (insErr) {
    throw new Error("OFFER_INSERT_ERROR: " + insErr.message);
  }

  const offer = Array.isArray(insData) ? (insData[0] as OfferRow) : null;

  return {
    ok: true,
    bookingId,
    bookingCode,
    timeoutSeconds,
    candidate,
    offer
  };
}

export async function acceptOffer(args: {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  responseSource?: string | null;
}) {
  const supabase = supabaseAdmin();
  const responseSource = String(args.responseSource || "driver").trim();
  const driverId = String(args.driverId || "").trim();

  if (!driverId) throw new Error("MISSING_DRIVER_ID");

  const booking = await resolveBooking(args);
  const bookingId = String(booking.id || "");
  const bookingCode = String(booking.booking_code || "");

  const offers = await listOffersForBooking(bookingId);
  const current = [...offers]
    .reverse()
    .find((o) => String(o.driver_id || "") === driverId && String(o.status || "") === "offered");

  if (!current?.id) {
    return {
      ok: false,
      error: "ACTIVE_OFFER_NOT_FOUND",
      bookingId,
      bookingCode,
      driverId
    };
  }

  const nowIso = new Date().toISOString();

  const { error: updOfferErr } = await supabase
    .from("dispatch_driver_offers")
    .update({
      status: "accepted",
      responded_at: nowIso,
      response_source: responseSource
    })
    .eq("id", current.id);

  if (updOfferErr) throw new Error("OFFER_ACCEPT_UPDATE_ERROR: " + updOfferErr.message);

  const offeredIdsToCancel = offers
    .filter((o) => String(o.status || "") === "offered" && String(o.id || "") !== String(current.id || ""))
    .map((o) => String(o.id || ""))
    .filter(Boolean);

  if (offeredIdsToCancel.length > 0) {
    await supabase
      .from("dispatch_driver_offers")
      .update({
        status: "cancelled",
        responded_at: nowIso,
        response_source: "system"
      })
      .in("id", offeredIdsToCancel);
  }

  const { data: updRows, error: updErr } = await supabase
    .from("bookings")
    .update({
      driver_id: driverId,
      assigned_driver_id: driverId,
      assigned_at: nowIso,
      status: "assigned",
      updated_at: nowIso
    })
    .eq("id", bookingId)
    .select("id,booking_code,status,driver_id")
    .limit(1);

  if (updErr) throw new Error("BOOKING_ASSIGN_ERROR: " + updErr.message);

  try {
    await supabase.from("booking_assignment_log").insert({
      booking_id: bookingId || null,
      booking_code: bookingCode || null,
      from_driver_id: String(booking.driver_id || "").trim() || null,
      to_driver_id: driverId,
      source: "offer_accept",
      actor: "system",
      note: null
    });
  } catch (e) {
    console.warn("BOOKING_ASSIGNMENT_LOG_INSERT_FAILED", e);
  }

  try {
    const { error: syncErr } = await supabase.rpc("sync_drivers_from_bookings");
    if (syncErr) console.warn("SYNC_DRIVERS_FROM_BOOKINGS_FAILED", syncErr);
  } catch (e) {
    console.warn("SYNC_DRIVERS_FROM_BOOKINGS_THROWN", e);
  }

  return {
    ok: true,
    bookingId,
    bookingCode,
    driverId,
    assignedRow: Array.isArray(updRows) ? updRows[0] : null
  };
}

export async function rejectOrExpireOffer(args: {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  action?: string | null;
  responseSource?: string | null;
  autoAdvance?: boolean;
  timeoutSeconds?: number;
}) {
  const supabase = supabaseAdmin();
  const driverId = String(args.driverId || "").trim();
  const action = String(args.action || "rejected").trim().toLowerCase();
  const responseSource = String(args.responseSource || "driver").trim();
  const autoAdvance = args.autoAdvance !== false;
  const timeoutSeconds = Number(args.timeoutSeconds || 8);

  if (!driverId) throw new Error("MISSING_DRIVER_ID");
  if (action !== "rejected" && action !== "expired") throw new Error("INVALID_ACTION");

  const booking = await resolveBooking(args);
  const bookingId = String(booking.id || "");
  const bookingCode = String(booking.booking_code || "");

  const offers = await listOffersForBooking(bookingId);
  const current = [...offers]
    .reverse()
    .find((o) => String(o.driver_id || "") === driverId && String(o.status || "") === "offered");

  if (!current?.id) {
    return {
      ok: false,
      error: "ACTIVE_OFFER_NOT_FOUND",
      bookingId,
      bookingCode,
      driverId
    };
  }

  const nowIso = new Date().toISOString();

  const { error: updOfferErr } = await supabase
    .from("dispatch_driver_offers")
    .update({
      status: action,
      responded_at: nowIso,
      response_source: responseSource
    })
    .eq("id", current.id);

  if (updOfferErr) throw new Error("OFFER_REJECT_UPDATE_ERROR: " + updOfferErr.message);

  let nextOffer: any = null;
  if (autoAdvance) {
    nextOffer = await createNextOffer({
      bookingId,
      bookingCode,
      timeoutSeconds,
      source: action
    });
  }

  return {
    ok: true,
    bookingId,
    bookingCode,
    driverId,
    action,
    nextOffer
  };
}

export async function advanceExpiredOffer(args: {
  bookingId?: string | null;
  bookingCode?: string | null;
  timeoutSeconds?: number;
}) {
  const timeoutSeconds = Number(args.timeoutSeconds || 8);
  const booking = await resolveBooking(args);
  const bookingId = String(booking.id || "");
  const bookingCode = String(booking.booking_code || "");

  const openOffer = await getOpenOfferForBooking(bookingId);
  if (openOffer?.id) {
    const exp = new Date(String(openOffer.expires_at || "")).getTime();
    if (Number.isFinite(exp) && exp > Date.now()) {
      return {
        ok: true,
        bookingId,
        bookingCode,
        reused_open_offer: true,
        offer: openOffer
      };
    }

    return await rejectOrExpireOffer({
      bookingId,
      bookingCode,
      driverId: String(openOffer.driver_id || ""),
      action: "expired",
      responseSource: "system",
      autoAdvance: true,
      timeoutSeconds
    });
  }

  return await createNextOffer({
    bookingId,
    bookingCode,
    timeoutSeconds,
    source: "advance"
  });
}