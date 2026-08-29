import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  computePublicVendorPerformance,
  isCompletedTakeoutOrder,
} from "@/lib/vendorPerformance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CANONICAL_TAKEOUT_TOWNS = [
  "Lamut",
  "Kiangan",
  "Lagawe",
  "Hingyon",
  "Banaue",
] as const;

const FORCE_VISIBLE_VENDOR_IDS = new Set<string>([
  "afa691c6-4a29-441f-b3bf-a8bb3a589ebe",
  "8af2c5a5-d325-4d49-af43-d5d1d5ab14cb",
  "23d549f7-565f-4476-90ca-ea10d7ee07b2",
]);

const FORCE_HIDDEN_VENDOR_IDS = new Set<string>([
  "54762c55-829c-425a-8183-7a682f61b75c",
  "1ad78ce7-a5a0-40fb-acec-e12cdefe94fb",
  "ae4a56e7-ff63-4cde-ba7e-5fae273272a2",
]);

type AvailabilityRow = {
  vendor_id?: string | null;
  effective_accepting_orders?: boolean | null;
  availability_reason?: string | null;
  hours_enforced?: boolean | null;
  hours_configured?: boolean | null;
  daily_opened?: boolean | null;
  normal_open_time?: string | null;
  normal_close_time?: string | null;
  scheduled_close_at?: string | null;
  extension_active?: boolean | null;
  extended_until?: string | null;
};

function adminClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function timestamp(value: unknown): number {
  const result = new Date(String(value || "")).getTime();
  return Number.isFinite(result) ? result : 0;
}

function normalizeTakeoutTown(value: unknown): string {
  const raw = cleanString(value).toLowerCase();
  return (
    CANONICAL_TAKEOUT_TOWNS.find(
      (town) => town.toLowerCase() === raw
    ) || ""
  );
}

function isRemovedFromPilot(status: unknown): boolean {
  return cleanString(status).toLowerCase() === "removed_from_pilot";
}

function normalizeVendor(
  vendor: any,
  publicPerformance: ReturnType<typeof computePublicVendorPerformance>,
  availability: AvailabilityRow | null
) {
  const logoUrl = cleanString(vendor?.logo_url);
  const originalTagline = cleanString(vendor?.tagline || "");
  const performanceText = publicPerformance.public_performance_text;
  const warningActive =
    timestamp(vendor?.public_response_warning_until) > Date.now();
  const suspended = timestamp(vendor?.suspended_until) > Date.now();
  const warningText = warningActive
    ? "JRide notice: Recent response issue."
    : "";
  const storefrontTagline = [
    warningText,
    performanceText,
    originalTagline,
  ]
    .filter(Boolean)
    .join(" ");

  const effectiveAcceptingOrders =
    availability?.effective_accepting_orders === true && !suspended;
  const availabilityReason = suspended
    ? "suspended"
    : cleanString(availability?.availability_reason || "unavailable");

  const {
    performance_metrics_started_at: _privateMetricsStart,
    public_response_warning_reason: _privateWarningReason,
    suspension_reason: _privateSuspensionReason,
    ...publicVendor
  } = vendor || {};

  return {
    ...publicVendor,
    name: cleanString(
      vendor?.display_name || vendor?.email || vendor?.id || "Vendor"
    ),
    display_name: cleanString(
      vendor?.display_name || vendor?.email || vendor?.id || "Vendor"
    ),
    town: normalizeTakeoutTown(vendor?.town),
    tagline: storefrontTagline,
    vendor_tagline: originalTagline,

    // Customer-facing marketplace availability must use the effective
    // business-hours + daily-open rule, never the stale manual switch.
    accepting_orders: effectiveAcceptingOrders,
    effective_accepting_orders: effectiveAcceptingOrders,
    manual_accepting_orders: vendor?.accepting_orders === true,
    availability_reason: availabilityReason,
    hours_enforced: availability?.hours_enforced === true,
    hours_configured: availability?.hours_configured === true,
    daily_opened: availability?.daily_opened === true,
    normal_open_time: availability?.normal_open_time || null,
    normal_close_time: availability?.normal_close_time || null,
    scheduled_close_at: availability?.scheduled_close_at || null,
    extension_active: availability?.extension_active === true,
    extended_until: availability?.extended_until || null,

    logo_url: logoUrl || null,
    vendor_logo_url: logoUrl || null,
    profile_logo_url: logoUrl || null,
    business_logo_url: logoUrl || null,
    performance_status:
      publicPerformance.acceptance_ready || publicPerformance.rating_ready
        ? "active"
        : "building",
    public_performance_text: performanceText,
    public_acceptance_rate: publicPerformance.public_acceptance_rate,
    public_customer_rating: publicPerformance.public_customer_rating,
    public_acceptance_ready: publicPerformance.acceptance_ready,
    public_rating_ready: publicPerformance.rating_ready,
    public_response_warning_active: warningActive,
    public_response_warning_until: warningActive
      ? vendor?.public_response_warning_until
      : null,
    public_response_warning_text: warningActive
      ? "Recent response issue"
      : null,
    suspended,
    suspended_until: suspended ? vendor?.suspended_until : null,
    availability_notice: suspended
      ? "Temporarily unavailable by JRide review"
      : availabilityReason === "hours_required"
        ? "Store hours setup required"
        : availabilityReason === "daily_open_required"
          ? "Store has not opened for orders today"
          : availabilityReason === "outside_hours"
            ? "Outside store hours"
            : null,
  };
}

export async function GET() {
  const supabase = adminClient();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error: "MISSING_SERVICE_ROLE",
        message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing",
      },
      { status: 500 }
    );
  }

  const selectCols =
    "id,email,display_name,created_at,town,lat,lng,location_label,logo_url,tagline,accepting_orders,performance_metrics_started_at,public_response_warning_until,public_response_warning_reason,suspended_until,suspension_reason";

  const [base, forced, availabilityRes] = await Promise.all([
    supabase
      .from("vendor_accounts")
      .select(selectCols)
      .order("created_at", { ascending: false }),
    supabase
      .from("vendor_accounts")
      .select(selectCols)
      .in("id", Array.from(FORCE_VISIBLE_VENDOR_IDS)),
    supabase.rpc("vendor_marketplace_effective_availability_bulk"),
  ]);

  if (base.error) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: base.error.message },
      { status: 500 }
    );
  }
  if (forced.error) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: forced.error.message },
      { status: 500 }
    );
  }
  if (availabilityRes.error) {
    return NextResponse.json(
      {
        ok: false,
        error: "AVAILABILITY_READ_FAILED",
        message: availabilityRes.error.message,
      },
      { status: 500 }
    );
  }

  const byId = new Map<string, any>();
  for (const row of Array.isArray(base.data) ? base.data : []) {
    const id = cleanString(row?.id);
    if (id) byId.set(id, row);
  }
  for (const row of Array.isArray(forced.data) ? forced.data : []) {
    const id = cleanString(row?.id);
    if (id) byId.set(id, row);
  }

  const rows = Array.from(byId.values());
  const vendorIds = rows
    .map((vendor: any) => cleanString(vendor?.id))
    .filter(Boolean);

  const availabilityByVendorId = new Map<string, AvailabilityRow>();
  for (const row of Array.isArray(availabilityRes.data)
    ? availabilityRes.data
    : []) {
    const vendorId = cleanString((row as AvailabilityRow)?.vendor_id);
    if (vendorId) availabilityByVendorId.set(vendorId, row as AvailabilityRow);
  }

  let removedIds = new Set<string>();
  let statusByVendorId = new Map<string, string>();

  if (vendorIds.length > 0) {
    const registry = await supabase
      .from("vendor_onboarding_credentials")
      .select("vendor_id,status")
      .in("vendor_id", vendorIds);

    if (registry.error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: registry.error.message },
        { status: 500 }
      );
    }

    const registryRows = Array.isArray(registry.data) ? registry.data : [];
    statusByVendorId = new Map<string, string>(
      registryRows
        .map(
          (row: any): [string, string] => [
            cleanString(row?.vendor_id),
            cleanString(row?.status).toLowerCase(),
          ]
        )
        .filter((row: [string, string]) => Boolean(row[0]))
    );

    removedIds = new Set(
      registryRows
        .filter((row: any) => isRemovedFromPilot(row?.status))
        .map((row: any) => cleanString(row?.vendor_id))
        .filter(Boolean)
    );
  }

  const cutoffValues = rows
    .map((vendor: any) => timestamp(vendor?.performance_metrics_started_at))
    .filter((value: number) => value > 0);
  const earliestCutoff = cutoffValues.length
    ? new Date(Math.min(...cutoffValues)).toISOString()
    : new Date().toISOString();

  const [
    bookingsRes,
    ratingsRes,
    testAccountsRes,
    bookingExclusionsRes,
  ] = await Promise.all([
    vendorIds.length
      ? supabase
          .from("bookings")
          .select(
            "id,vendor_id,created_by_user_id,service_type,status,vendor_status,customer_status,created_at,updated_at,vendor_responded_at,vendor_accepted_at,vendor_rejected_at,vendor_timeout_at,vendor_cancel_reason,cancel_reason"
          )
          .eq("service_type", "takeout")
          .in("vendor_id", vendorIds)
          .gte("created_at", earliestCutoff)
          .order("created_at", { ascending: false })
          .limit(10000)
      : Promise.resolve({ data: [], error: null } as any),
    vendorIds.length
      ? supabase
          .from("takeout_ratings")
          .select(
            "id,booking_id,passenger_id,vendor_id,vendor_rating,created_at"
          )
          .in("vendor_id", vendorIds)
          .gte("created_at", earliestCutoff)
          .order("created_at", { ascending: false })
          .limit(10000)
      : Promise.resolve({ data: [], error: null } as any),
    supabase
      .from("analytics_test_accounts")
      .select("subject_type,subject_id")
      .eq("active", true),
    supabase
      .from("analytics_booking_exclusions")
      .select("booking_id")
      .eq("active", true),
  ]);

  const rawBookings =
    !bookingsRes.error && Array.isArray(bookingsRes.data)
      ? bookingsRes.data
      : [];
  const rawRatings =
    !ratingsRes.error && Array.isArray(ratingsRes.data)
      ? ratingsRes.data
      : [];

  const testPassengerIds = new Set(
    !testAccountsRes.error && Array.isArray(testAccountsRes.data)
      ? testAccountsRes.data
          .filter(
            (row: any) => cleanString(row?.subject_type) === "passenger_user"
          )
          .map((row: any) => cleanString(row?.subject_id))
          .filter(Boolean)
      : []
  );

  const excludedBookingIds = new Set(
    !bookingExclusionsRes.error && Array.isArray(bookingExclusionsRes.data)
      ? bookingExclusionsRes.data
          .map((row: any) => cleanString(row?.booking_id))
          .filter(Boolean)
      : []
  );

  const bookingsById = new Map<string, any>();
  for (const booking of rawBookings) {
    const bookingId = cleanString(booking?.id);
    if (bookingId) bookingsById.set(bookingId, booking);
  }

  const performanceByVendor = new Map<
    string,
    ReturnType<typeof computePublicVendorPerformance>
  >();

  for (const vendor of rows) {
    const vendorId = cleanString(vendor?.id);
    const cutoff = timestamp(vendor?.performance_metrics_started_at);

    const eligibleBookings = rawBookings.filter((booking: any) => {
      if (cleanString(booking?.vendor_id) !== vendorId) return false;
      if (timestamp(booking?.created_at) < cutoff) return false;
      if (excludedBookingIds.has(cleanString(booking?.id))) return false;
      if (testPassengerIds.has(cleanString(booking?.created_by_user_id))) {
        return false;
      }
      return true;
    });

    const eligibleBookingIds = new Set(
      eligibleBookings.map((booking: any) => cleanString(booking?.id))
    );

    const eligibleRatings = rawRatings.filter((rating: any) => {
      if (cleanString(rating?.vendor_id) !== vendorId) return false;
      if (timestamp(rating?.created_at) < cutoff) return false;
      if (testPassengerIds.has(cleanString(rating?.passenger_id))) return false;

      const bookingId = cleanString(rating?.booking_id);
      if (!bookingId || !eligibleBookingIds.has(bookingId)) return false;
      if (excludedBookingIds.has(bookingId)) return false;

      const linkedBooking = bookingsById.get(bookingId);
      return linkedBooking ? isCompletedTakeoutOrder(linkedBooking) : false;
    });

    performanceByVendor.set(
      vendorId,
      computePublicVendorPerformance(eligibleBookings, eligibleRatings)
    );
  }

  const vendors = rows
    .filter((vendor: any) => {
      const id = cleanString(vendor?.id);
      if (FORCE_VISIBLE_VENDOR_IDS.has(id)) return true;
      return !removedIds.has(id) && !FORCE_HIDDEN_VENDOR_IDS.has(id);
    })
    .map((vendor: any) => {
      const id = cleanString(vendor?.id);
      const performance =
        performanceByVendor.get(id) || computePublicVendorPerformance([], []);
      const availability = availabilityByVendorId.get(id) || null;
      const normalized = normalizeVendor(vendor, performance, availability);
      const marketplaceStatus = statusByVendorId.get(id) || "";

      return {
        ...normalized,
        marketplace_status: marketplaceStatus,
        onboarding_status: marketplaceStatus,
        is_batch2: marketplaceStatus === "batch2",
      };
    });

  return NextResponse.json(
    { ok: true, vendors },
    {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    }
  );
}

export async function POST(req: Request) {
  const supabase = adminClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "MISSING_SERVICE_ROLE" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const vendorId = cleanString(body?.vendor_id);
    const status = cleanString(body?.status).toLowerCase();

    if (!vendorId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_VENDOR_ID" },
        { status: 400 }
      );
    }

    if (
      !["pilot_lagawe", "batch2", "removed_from_pilot"].includes(status)
    ) {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS" },
        { status: 400 }
      );
    }

    const result = await supabase
      .from("vendor_onboarding_credentials")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("vendor_id", vendorId);

    if (result.error) {
      return NextResponse.json(
        { ok: false, error: result.error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, vendor_id: vendorId, status });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error) },
      { status: 500 }
    );
  }
}
