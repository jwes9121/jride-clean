import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type VendorPerformanceSources = {
  vendors: any[];
  settings: any[];
  bookings: any[];
  ratings: any[];
  testSubjects: any[];
  bookingExclusions: any[];
  presenceCurrent: any[];
  presenceBuckets: any[];
};

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

export function createVendorMetricsAdmin(): SupabaseClient {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) throw new Error("Missing Supabase service role configuration.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchAllRows(
  loader: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
  label: string
): Promise<any[]> {
  const pageSize = 1000;
  const out: any[] = [];

  for (let from = 0; ; from += pageSize) {
    const result = await loader(from, from + pageSize - 1);
    if (result.error) throw new Error(label + ": " + String(result.error.message || result.error));
    const rows = Array.isArray(result.data) ? result.data : [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}

export async function loadVendorPerformanceSources(
  admin: SupabaseClient,
  options?: { includePresence?: boolean }
): Promise<VendorPerformanceSources> {
  const settingsResult = await admin
    .from("vendor_performance_settings")
    .select("vendor_id,metrics_started_at,public_acceptance_min_decisions,public_rating_min_surveys,recent_decision_limit,recent_rating_limit")
    .order("metrics_started_at", { ascending: true });

  if (settingsResult.error) {
    throw new Error("vendor_performance_settings: " + settingsResult.error.message);
  }

  const settings = Array.isArray(settingsResult.data) ? settingsResult.data : [];
  const earliestCutoff = settings
    .map((row: any) => String(row?.metrics_started_at || "").trim())
    .filter(Boolean)
    .sort()[0] || new Date().toISOString();

  const [vendors, bookings, ratings, testSubjects, bookingExclusions] = await Promise.all([
    fetchAllRows(
      (from, to) => admin
        .from("vendor_accounts")
        .select("id,email,display_name,created_at,town,logo_url,tagline,accepting_orders")
        .order("display_name", { ascending: true })
        .range(from, to),
      "vendor_accounts"
    ),
    fetchAllRows(
      (from, to) => admin
        .from("bookings")
        .select("id,booking_code,vendor_id,created_by_user_id,passenger_name,service_type,status,vendor_status,customer_status,driver_status,created_at,updated_at,completed_at,assigned_driver_id,driver_id,takeout_fee_proposed_at,takeout_customer_confirmed_at,vendor_responded_at,vendor_accepted_at,vendor_rejected_at,vendor_timeout_at,cancel_reason,vendor_cancel_reason,takeout_items_subtotal,takeout_total_payable")
        .eq("service_type", "takeout")
        .gte("created_at", earliestCutoff)
        .order("created_at", { ascending: false })
        .range(from, to),
      "bookings"
    ),
    fetchAllRows(
      (from, to) => admin
        .from("takeout_ratings")
        .select("id,booking_id,booking_code,passenger_id,vendor_id,vendor_rating,vendor_comment,created_at")
        .gte("created_at", earliestCutoff)
        .order("created_at", { ascending: false })
        .range(from, to),
      "takeout_ratings"
    ),
    fetchAllRows(
      (from, to) => admin
        .from("analytics_test_subjects")
        .select("id,subject_type,subject_id,reason,active,marked_by,created_at,updated_at")
        .order("created_at", { ascending: false })
        .range(from, to),
      "analytics_test_subjects"
    ),
    fetchAllRows(
      (from, to) => admin
        .from("analytics_booking_exclusions")
        .select("booking_id,reason,active,marked_by,created_at,updated_at")
        .order("created_at", { ascending: false })
        .range(from, to),
      "analytics_booking_exclusions"
    ),
  ]);

  let presenceCurrent: any[] = [];
  let presenceBuckets: any[] = [];

  if (options?.includePresence) {
    [presenceCurrent, presenceBuckets] = await Promise.all([
      fetchAllRows(
        (from, to) => admin
          .from("vendor_presence_current")
          .select("vendor_id,last_seen_at,surface,updated_at")
          .order("last_seen_at", { ascending: false })
          .range(from, to),
        "vendor_presence_current"
      ),
      fetchAllRows(
        (from, to) => admin
          .from("vendor_presence_buckets")
          .select("vendor_id,bucket_start,surface")
          .gte("bucket_start", earliestCutoff)
          .order("bucket_start", { ascending: false })
          .range(from, to),
        "vendor_presence_buckets"
      ),
    ]);
  }

  return {
    vendors,
    settings,
    bookings,
    ratings,
    testSubjects,
    bookingExclusions,
    presenceCurrent,
    presenceBuckets,
  };
}

export function activeMetricExclusions(sources: VendorPerformanceSources) {
  const testPassengerIds = new Set<string>();
  const testVendorIds = new Set<string>();
  const excludedBookingIds = new Set<string>();

  for (const row of sources.testSubjects) {
    if (row?.active !== true) continue;
    const id = String(row?.subject_id || "").trim();
    if (!id) continue;
    if (String(row?.subject_type || "").trim() === "passenger") testPassengerIds.add(id);
    if (String(row?.subject_type || "").trim() === "vendor") testVendorIds.add(id);
  }

  for (const row of sources.bookingExclusions) {
    if (row?.active !== true) continue;
    const id = String(row?.booking_id || "").trim();
    if (id) excludedBookingIds.add(id);
  }

  return { testPassengerIds, testVendorIds, excludedBookingIds };
}

export function metricBookingIsExcluded(
  row: any,
  exclusions: ReturnType<typeof activeMetricExclusions>
): boolean {
  const bookingId = String(row?.id || "").trim();
  const passengerId = String(row?.created_by_user_id || "").trim();
  const vendorId = String(row?.vendor_id || "").trim();
  return (
    (bookingId && exclusions.excludedBookingIds.has(bookingId)) ||
    (passengerId && exclusions.testPassengerIds.has(passengerId)) ||
    (vendorId && exclusions.testVendorIds.has(vendorId))
  );
}
