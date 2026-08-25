import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ERRAND_RECEIPT_BUCKET = "errand-receipts";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function errandFeatureEnabled(): boolean {
  const raw = text(process.env.JRIDE_ERRAND_BOOKING_ENABLED).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function loadErrandBundleByBookingId(bookingId: string) {
  const admin = supabaseAdmin();

  const bookingRes = await admin
    .from("bookings")
    .select(
      "id,booking_code,passenger_name,created_by_user_id,service_type,status,town,from_label,to_label,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,driver_id,assigned_driver_id,driver_to_pickup_km,pickup_distance_fee,base_fee,distance_fare,waiting_minutes,waiting_fee,stop_count,extra_stop_fee,elevation_surcharge,heavy_load_fee,total_errand_fare,company_cut,driver_payout,created_at,updated_at"
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingRes.error || !bookingRes.data) {
    return {
      ok: false as const,
      error: bookingRes.error?.message || "BOOKING_NOT_FOUND",
    };
  }

  if (text((bookingRes.data as any).service_type).toLowerCase() !== "errand") {
    return { ok: false as const, error: "NOT_ERRAND_BOOKING" };
  }

  const [jobRes, stopsRes, settingsRes, adjustmentsRes, fundEventsRes] =
    await Promise.all([
      admin.from("errand_jobs").select("*").eq("booking_id", bookingId).maybeSingle(),
      admin
        .from("errand_stops")
        .select("*")
        .eq("booking_id", bookingId)
        .order("sequence", { ascending: true }),
      admin
        .from("errand_pricing_settings")
        .select("*")
        .eq("singleton", true)
        .maybeSingle(),
      admin
        .from("errand_route_adjustments")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true }),
      admin
        .from("errand_pabili_fund_events")
        .select("id,booking_id,stop_sequence,event_type,amount,confirmation_method,created_at")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true }),
    ]);

  if (jobRes.error || !jobRes.data) {
    return {
      ok: false as const,
      error: jobRes.error?.message || "ERRAND_JOB_NOT_FOUND",
    };
  }

  if (stopsRes.error) {
    return { ok: false as const, error: stopsRes.error.message };
  }

  if (settingsRes.error || !settingsRes.data) {
    return {
      ok: false as const,
      error: settingsRes.error?.message || "ERRAND_PRICING_NOT_CONFIGURED",
    };
  }

  if (adjustmentsRes.error) {
    return { ok: false as const, error: adjustmentsRes.error.message };
  }

  if (fundEventsRes.error) {
    return { ok: false as const, error: fundEventsRes.error.message };
  }

  return {
    ok: true as const,
    booking: bookingRes.data,
    job: jobRes.data,
    stops: Array.isArray(stopsRes.data) ? stopsRes.data : [],
    settings: settingsRes.data,
    routeAdjustments: Array.isArray(adjustmentsRes.data)
      ? adjustmentsRes.data
      : [],
    pabiliFundEvents: Array.isArray(fundEventsRes.data)
      ? fundEventsRes.data
      : [],
  };
}

export function errandPabiliAccounting(
  job: any,
  stops: any[],
  fundEvents: any[] = []
) {
  const isPabili = Boolean(job?.is_pabili);
  if (!isPabili) {
    return {
      is_pabili: false,
      customer_purchase_funds_received: 0,
      purchase_total: 0,
      shortfall: 0,
      change_due: 0,
      change_returned: 0,
      change_remaining: 0,
      accounting_balanced: true,
      purchase_stops: [],
      fund_events: [],
    };
  }

  const customerFunds = Math.max(0, num(job?.pabili_cash_received));
  const purchaseStops = (Array.isArray(stops) ? stops : [])
    .map((stop: any) => ({
      sequence: Math.max(0, Math.floor(num(stop?.sequence))),
      location_label: text(stop?.location_label) || null,
      purchase_total: Math.max(0, num(stop?.purchase_total)),
      receipt_available: !!text(stop?.receipt_photo_url),
    }))
    .filter((stop: any) => stop.purchase_total > 0 || stop.receipt_available);

  const purchaseTotal = Number(
    purchaseStops
      .reduce((sum: number, stop: any) => sum + stop.purchase_total, 0)
      .toFixed(2)
  );
  const shortfall = Number(Math.max(purchaseTotal - customerFunds, 0).toFixed(2));
  const changeDue = Number(Math.max(customerFunds - purchaseTotal, 0).toFixed(2));
  const changeReturned = Number(
    Math.max(0, num(job?.pabili_change_returned)).toFixed(2)
  );
  const changeRemaining = Number(
    Math.max(changeDue - changeReturned, 0).toFixed(2)
  );

  return {
    is_pabili: true,
    customer_purchase_funds_received: Number(customerFunds.toFixed(2)),
    purchase_total: purchaseTotal,
    stored_purchase_total: Number(
      Math.max(0, num(job?.pabili_purchase_total)).toFixed(2)
    ),
    shortfall,
    change_due: changeDue,
    stored_change_due: Number(
      Math.max(0, num(job?.pabili_change_due)).toFixed(2)
    ),
    change_returned: changeReturned,
    change_remaining: changeRemaining,
    accounting_balanced: shortfall <= 0.009 && changeRemaining <= 0.009,
    purchase_stops: purchaseStops,
    fund_events: (Array.isArray(fundEvents) ? fundEvents : []).map((event: any) => ({
      id: text(event?.id) || null,
      stop_sequence:
        event?.stop_sequence == null
          ? null
          : Math.max(0, Math.floor(num(event?.stop_sequence))),
      event_type: text(event?.event_type) || null,
      amount: Number(Math.max(0, num(event?.amount)).toFixed(2)),
      confirmation_method: text(event?.confirmation_method) || null,
      created_at: text(event?.created_at) || null,
    })),
  };
}

export async function createErrandReceiptSignedUrl(
  path: string,
  expiresInSeconds = 600
) {
  const cleanPath = text(path);
  if (!cleanPath || cleanPath.includes("://")) {
    return { ok: false as const, error: "INVALID_RECEIPT_PATH" };
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.storage
    .from(ERRAND_RECEIPT_BUCKET)
    .createSignedUrl(cleanPath, Math.max(60, Math.min(expiresInSeconds, 3600)));

  if (error || !data?.signedUrl) {
    return {
      ok: false as const,
      error: error?.message || "RECEIPT_SIGNED_URL_FAILED",
    };
  }

  return {
    ok: true as const,
    signedUrl: data.signedUrl,
    expiresInSeconds: Math.max(60, Math.min(expiresInSeconds, 3600)),
  };
}

export function errandFareBreakdown(
  booking: any,
  job?: any,
  settings?: any
) {
  const baseFare = num(booking?.base_fee);
  const pickupDistanceFee = num(booking?.pickup_distance_fee);
  const distanceFare = num(booking?.distance_fare);
  const extraStopFee = num(booking?.extra_stop_fee);
  const storedWaitingFee = num(booking?.waiting_fee);
  const elevationSurcharge = num(booking?.elevation_surcharge);
  const heavyLoadFee = num(booking?.heavy_load_fee);
  const companyCut = num(
    booking?.company_cut,
    num(settings?.company_cut_flat, 20)
  );

  const storedWaitSeconds = Math.max(
    0,
    Math.floor(num(job?.waiting_accumulated_seconds))
  );
  const waitingStartedAt = text(job?.waiting_started_at);
  const stage = text(job?.errand_stage).toLowerCase();
  const finalHandoffWaiting = stage === "waiting_at_final_handoff";
  const finalHandoffLimitSeconds = 30 * 60;
  let rawRunningWaitSeconds = 0;

  if (waitingStartedAt) {
    const startedMs = Date.parse(waitingStartedAt);
    if (Number.isFinite(startedMs)) {
      rawRunningWaitSeconds = Math.max(
        0,
        Math.floor((Date.now() - startedMs) / 1000)
      );
    }
  }

  const runningWaitSeconds = finalHandoffWaiting
    ? Math.min(rawRunningWaitSeconds, finalHandoffLimitSeconds)
    : rawRunningWaitSeconds;
  const currentWaitSeconds = storedWaitSeconds + runningWaitSeconds;
  const currentWaitMinutes =
    currentWaitSeconds > 0 ? Math.ceil(currentWaitSeconds / 60) : 0;

  const freeMinutes = Math.max(
    0,
    Math.floor(num(settings?.waiting_free_minutes, 15))
  );
  const blockMinutes = Math.max(
    1,
    Math.floor(num(settings?.waiting_block_minutes, 15))
  );
  const feePerBlock = Math.max(
    0,
    num(settings?.waiting_fee_per_block, 20)
  );
  const paidMinutes = Math.max(currentWaitMinutes - freeMinutes, 0);
  const paidBlocks = paidMinutes > 0 ? Math.ceil(paidMinutes / blockMinutes) : 0;
  const liveWaitingFee = paidBlocks * feePerBlock;

  const currentTotal = Number(
    (
      baseFare +
      pickupDistanceFee +
      distanceFare +
      extraStopFee +
      liveWaitingFee +
      elevationSurcharge +
      heavyLoadFee
    ).toFixed(2)
  );

  const freeRemainingSeconds = Math.max(
    freeMinutes * 60 - currentWaitSeconds,
    0
  );
  const finalLocalWaitSeconds = finalHandoffWaiting
    ? Math.min(rawRunningWaitSeconds, finalHandoffLimitSeconds)
    : 0;

  return {
    base_fare: baseFare,
    pickup_distance_fee: pickupDistanceFee,
    distance_fare: distanceFare,
    extra_stop_fee: extraStopFee,
    waiting_fee: liveWaitingFee,
    stored_waiting_fee: storedWaitingFee,
    elevation_surcharge: elevationSurcharge,
    heavy_load_fee: heavyLoadFee,
    total_errand_fare: currentTotal,
    stored_total_errand_fare: num(booking?.total_errand_fare),
    company_cut: companyCut,
    driver_payout: Math.max(
      Number((currentTotal - companyCut).toFixed(2)),
      0
    ),
    waiting: {
      running: !!waitingStartedAt,
      waiting_started_at: waitingStartedAt || null,
      accumulated_seconds: storedWaitSeconds,
      running_seconds: runningWaitSeconds,
      current_total_seconds: currentWaitSeconds,
      current_total_minutes: currentWaitMinutes,
      free_minutes: freeMinutes,
      free_remaining_seconds: freeRemainingSeconds,
      chargeable_minutes: paidMinutes,
      chargeable_started_blocks: paidBlocks,
      block_minutes: blockMinutes,
      fee_per_block: feePerBlock,
      current_fee: liveWaitingFee,
    },
    final_handoff: {
      active: finalHandoffWaiting,
      local_wait_seconds: finalLocalWaitSeconds,
      local_wait_limit_seconds: finalHandoffLimitSeconds,
      local_wait_remaining_seconds: finalHandoffWaiting
        ? Math.max(finalHandoffLimitSeconds - rawRunningWaitSeconds, 0)
        : null,
      cutoff_reached:
        finalHandoffWaiting && rawRunningWaitSeconds >= finalHandoffLimitSeconds,
    },
  };
}
