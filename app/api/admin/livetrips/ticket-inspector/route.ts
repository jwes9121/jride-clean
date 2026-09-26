import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

function getSupabase() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRole) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isStaffRole(role: unknown): boolean {
  const r = String(role || "").toLowerCase();
  return r === "admin" || r === "dispatcher";
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}

function asArray<T>(v: T[] | T | null | undefined): T[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function ts(v: unknown): number {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : 0;
}

function diagnostic(
  severity: string,
  code: string,
  message: string,
  evidence: string[],
) {
  return { severity, code, message, evidence };
}

function timelineItem(
  at: string | null,
  source: string,
  actor: string | null,
  action: string,
  evidence: any,
  from_status?: string | null,
  to_status?: string | null,
) {
  return {
    at,
    source,
    actor,
    action,
    from_status: from_status ?? null,
    to_status: to_status ?? null,
    evidence,
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const sessionUser = (session?.user ?? null) as any;
  const role = String(sessionUser?.role || "").toLowerCase();

  if (!sessionUser) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Sign in required." },
      { status: 401 },
    );
  }

  if (!isStaffRole(role)) {
    return NextResponse.json(
      {
        ok: false,
        error: "FORBIDDEN",
        message: "Admin or dispatcher role required.",
      },
      { status: 403 },
    );
  }

  const q = text(req.nextUrl.searchParams.get("q"));
  if (!q) {
    return NextResponse.json(
      {
        ok: false,
        error: "MISSING_QUERY",
        message: "Ticket query is required.",
      },
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabase();

    let bookingRows: any[] = [];

    if (isUuid(q)) {
      const byId = await supabase
        .from("bookings")
        .select("*")
        .eq("id", q)
        .limit(5);

      if (byId.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "BOOKING_LOOKUP_FAILED",
            message: byId.error.message,
          },
          { status: 500 },
        );
      }

      bookingRows = asArray<any>(byId.data);
    }

    if (!bookingRows.length) {
      const byCode = await supabase
        .from("bookings")
        .select("*")
        .ilike("booking_code", "%" + q + "%")
        .order("updated_at", { ascending: false })
        .limit(10);

      if (byCode.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "BOOKING_LOOKUP_FAILED",
            message: byCode.error.message,
          },
          { status: 500 },
        );
      }

      bookingRows = asArray<any>(byCode.data);
    }

    if (!bookingRows.length) {
      let agriRows: any[] = [];

      if (isUuid(q)) {
        const byAgriId = await supabase
          .from("agrimarket_orders")
          .select("*")
          .eq("id", q)
          .limit(5);

        if (byAgriId.error) {
          return NextResponse.json(
            {
              ok: false,
              error: "AGRIMARKET_LOOKUP_FAILED",
              message: byAgriId.error.message,
            },
            { status: 500 },
          );
        }

        agriRows = asArray<any>(byAgriId.data);
      }

      if (!agriRows.length) {
        const byAgriCode = await supabase
          .from("agrimarket_orders")
          .select("*")
          .ilike("order_code", "%" + q + "%")
          .order("updated_at", { ascending: false })
          .limit(10);

        if (byAgriCode.error) {
          return NextResponse.json(
            {
              ok: false,
              error: "AGRIMARKET_LOOKUP_FAILED",
              message: byAgriCode.error.message,
            },
            { status: 500 },
          );
        }

        agriRows = asArray<any>(byAgriCode.data);
      }

      if (agriRows.length) {
        const order = agriRows[0];
        const orderId = text(order?.id);
        const producerId = text(order?.producer_id);
        const customerId = text(order?.customer_user_id);
        const driverId = text(order?.assigned_driver_id);

        const itemsRes = await supabase
          .from("agrimarket_order_items")
          .select("*")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true });

        const eventsRes = await supabase
          .from("agrimarket_order_events")
          .select("*")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true });

        const offersRes = await supabase
          .from("agrimarket_driver_offers")
          .select("*")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true });

        const pickupChecksRes = await supabase
          .from("agrimarket_pickup_checks")
          .select("*")
          .eq("order_id", orderId)
          .order("checked_at", { ascending: true });

        const handlingEventsRes = await supabase
          .from("agrimarket_handling_fee_events")
          .select("*")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true });

        const reservationsRes = await supabase
          .from("agrimarket_inventory_reservations")
          .select("*")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true });

        const relatedErrors = [
          itemsRes.error,
          eventsRes.error,
          offersRes.error,
          pickupChecksRes.error,
          handlingEventsRes.error,
          reservationsRes.error,
        ].filter(Boolean);

        if (relatedErrors.length) {
          return NextResponse.json(
            {
              ok: false,
              error: "AGRIMARKET_DETAIL_LOOKUP_FAILED",
              message: String((relatedErrors[0] as any)?.message || relatedErrors[0]),
            },
            { status: 500 },
          );
        }

        let producer: any = null;
        if (producerId) {
          const producerRes = await supabase
            .from("agrimarket_producers")
            .select("*")
            .eq("id", producerId)
            .limit(1);
          if (producerRes.error) {
            return NextResponse.json(
              {
                ok: false,
                error: "AGRIMARKET_PRODUCER_LOOKUP_FAILED",
                message: producerRes.error.message,
              },
              { status: 500 },
            );
          }
          producer = asArray<any>(producerRes.data)[0] || null;
        }

        let passenger: any = null;
        if (customerId) {
          const passengerRes = await supabase
            .from("passenger_profiles")
            .select("user_id, full_name, phone, email, town_origin, barangay_origin")
            .eq("user_id", customerId)
            .limit(1);
          if (passengerRes.error) {
            return NextResponse.json(
              {
                ok: false,
                error: "PASSENGER_PROFILE_LOOKUP_FAILED",
                message: passengerRes.error.message,
              },
              { status: 500 },
            );
          }
          passenger = asArray<any>(passengerRes.data)[0] || null;
        }

        let driverProfile: any = null;
        let driverAccount: any = null;
        if (driverId) {
          const driverProfileRes = await supabase
            .from("driver_profiles")
            .select("driver_id, full_name, callsign, phone, municipality, vehicle_type, plate_number, toda_org, is_toda_member")
            .eq("driver_id", driverId)
            .limit(1);
          if (driverProfileRes.error) {
            return NextResponse.json(
              {
                ok: false,
                error: "DRIVER_PROFILE_LOOKUP_FAILED",
                message: driverProfileRes.error.message,
              },
              { status: 500 },
            );
          }
          driverProfile = asArray<any>(driverProfileRes.data)[0] || null;

          const driverAccountRes = await supabase
            .from("drivers")
            .select("id, driver_name, driver_status, roster_status, wallet_balance, min_wallet_required, wallet_locked, toda_name")
            .eq("id", driverId)
            .limit(1);
          if (driverAccountRes.error) {
            return NextResponse.json(
              {
                ok: false,
                error: "DRIVER_ACCOUNT_LOOKUP_FAILED",
                message: driverAccountRes.error.message,
              },
              { status: 500 },
            );
          }
          driverAccount = asArray<any>(driverAccountRes.data)[0] || null;
        }

        const agriItems = asArray<any>(itemsRes.data);
        const agriEvents = asArray<any>(eventsRes.data);
        const agriOffers = asArray<any>(offersRes.data);
        const pickupChecks = asArray<any>(pickupChecksRes.data);
        const handlingEvents = asArray<any>(handlingEventsRes.data);
        const reservations = asArray<any>(reservationsRes.data);

        const normalizedOrder = {
          ...order,
          booking_code: order?.order_code ?? null,
          passenger_name: passenger?.full_name ?? null,
          from_label: producer?.pickup_label ?? null,
          to_label: order?.delivery_label ?? null,
          town: producer?.town ?? null,
          service_type: "agrimarket",
          trip_type: "agrimarket",
          effective_status: order?.status ?? null,
          driver_id: order?.assigned_driver_id ?? null,
          assigned_driver_id: order?.assigned_driver_id ?? null,
          vendor_id: order?.producer_id ?? null,
          created_by_user_id: order?.customer_user_id ?? null,
          company_cut: order?.delivery_company_cut ?? null,
          driver_payout: order?.driver_delivery_payout ?? null,
        };

        const timeline = [
          timelineItem(
            order?.created_at ?? null,
            "agrimarket_orders",
            "system",
            "order_created",
            order,
            null,
            order?.status ?? null,
          ),
          ...agriEvents.map((row) =>
            timelineItem(
              row?.created_at ?? null,
              "agrimarket_order_events",
              text(row?.actor_type || "system") + (row?.actor_id ? ":" + text(row?.actor_id) : ""),
              text(row?.reason_code || row?.to_status || "agrimarket_event"),
              row,
              row?.from_status ?? null,
              row?.to_status ?? null,
            ),
          ),
          ...agriOffers.map((row) =>
            timelineItem(
              row?.responded_at || row?.offered_at || row?.created_at || null,
              "agrimarket_driver_offers",
              text(row?.driver_id || "dispatch"),
              "driver_offer_" + text(row?.status || "created").toLowerCase(),
              row,
              null,
              row?.status ?? null,
            ),
          ),
          ...pickupChecks.map((row) =>
            timelineItem(
              row?.checked_at ?? null,
              "agrimarket_pickup_checks",
              text(row?.driver_id || "driver"),
              "pickup_check_" + text(row?.check_type || "check") + "_" + text(row?.result || "unknown"),
              row,
              null,
              row?.result ?? null,
            ),
          ),
          ...handlingEvents.map((row) =>
            timelineItem(
              row?.created_at ?? null,
              "agrimarket_handling_fee_events",
              text(row?.driver_id || "system"),
              "handling_fee_" + text(row?.action || "event"),
              row,
              null,
              null,
            ),
          ),
        ].sort((a, b) => ts(a.at) - ts(b.at));

        const diagnostics: any[] = [];
        if (!agriEvents.length) {
          diagnostics.push(
            diagnostic(
              "warn",
              "NO_AGRIMARKET_ORDER_EVENTS",
              "No AgriMarket order event rows were found for this order.",
              ["agrimarket_order_events count = 0"],
            ),
          );
        }
        if (order?.assigned_driver_id) {
          diagnostics.push(
            diagnostic(
              "info",
              "DRIVER_ATTACHED",
              "AgriMarket order has an assigned driver.",
              ["assigned_driver_id is present"],
            ),
          );
        }
        if (
          text(order?.status).toLowerCase() === "completed" &&
          text(order?.wallet_settlement_status).toLowerCase() !== "settled"
        ) {
          diagnostics.push(
            diagnostic(
              "warn",
              "AGRIMARKET_WALLET_NOT_SETTLED",
              "Completed AgriMarket order is not marked as wallet settled.",
              ["wallet_settlement_status = " + text(order?.wallet_settlement_status)],
            ),
          );
        }
        if (!producer) {
          diagnostics.push(
            diagnostic(
              "warn",
              "AGRIMARKET_PRODUCER_NOT_FOUND",
              "The order references a producer, but the producer profile was not found.",
              ["producer_id = " + producerId],
            ),
          );
        }

        const people = {
          passenger,
          driver: driverProfile,
          driver_account: driverAccount,
          producer,
          vendor: producer,
        };

        const serviceDetails = {
          service_type: "agrimarket",
          order,
          items: agriItems,
          producer,
          driver_offers: agriOffers,
          pickup_checks: pickupChecks,
          handling_fee_events: handlingEvents,
          inventory_reservations: reservations,
        };

        return NextResponse.json({
          ok: true,
          query: q,
          booking: normalizedOrder,
          people,
          service_details: serviceDetails,
          matches: agriRows.map((row) => ({
            id: row?.id ?? null,
            booking_code: row?.order_code ?? null,
            status: row?.status ?? null,
            service_type: "agrimarket",
            passenger_name: null,
            town: null,
            updated_at: row?.updated_at ?? null,
          })),
          timeline,
          diagnostics,
          raw: {
            agrimarket_order: order,
            agrimarket_order_items: agriItems,
            agrimarket_order_events: agriEvents,
            agrimarket_driver_offers: agriOffers,
            agrimarket_pickup_checks: pickupChecks,
            agrimarket_handling_fee_events: handlingEvents,
            agrimarket_inventory_reservations: reservations,
            people,
            service_details: serviceDetails,
            note: "Service-aware inspector: AgriMarket uses agrimarket_orders and its dedicated event tables.",
          },
        });
      }

      return NextResponse.json(
        {
          ok: false,
          error: "TICKET_NOT_FOUND",
          message: "No Ride, Takeout, Errand, or AgriMarket ticket matched this query.",
        },
        { status: 404 },
      );
    }

    const booking = bookingRows[0];
    const bookingId = text(booking?.id);
    const bookingCode = text(booking?.booking_code);
    const serviceType = text(booking?.service_type || booking?.trip_type).toLowerCase();

    const statusAuditRes = await supabase
      .from("booking_status_audit")
      .select(
        "id, booking_id, old_status, new_status, source, actor_type, actor_id, created_at",
      )
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });

    if (statusAuditRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_STATUS_AUDIT_FAILED",
          message: statusAuditRes.error.message,
        },
        { status: 500 },
      );
    }

    const adminAuditLogRes = await supabase
      .from("admin_audit_log")
      .select(
        "id, created_at, actor_id, actor_email, action, booking_id, booking_code, from_status, to_status, meta",
      )
      .or("booking_id.eq." + bookingId + ",booking_code.eq." + bookingCode)
      .order("created_at", { ascending: true });

    if (adminAuditLogRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ADMIN_AUDIT_LOG_FAILED",
          message: adminAuditLogRes.error.message,
        },
        { status: 500 },
      );
    }

    const adminAuditLogsRes = await supabase
      .from("admin_audit_logs")
      .select("id, created_at, actor, action, entity_type, entity_id, payload")
      .in("entity_id", [bookingId, bookingCode])
      .order("created_at", { ascending: true });

    if (adminAuditLogsRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ADMIN_AUDIT_LOGS_FAILED",
          message: adminAuditLogsRes.error.message,
        },
        { status: 500 },
      );
    }

    const statusAuditRows = asArray<any>(statusAuditRes.data);
    const adminAuditLogRows = asArray<any>(adminAuditLogRes.data);
    const adminAuditLogsRows = asArray<any>(adminAuditLogsRes.data);

    const dispatchActionsRes = await supabase
      .from("dispatch_actions")
      .select(
        "id, created_at, dispatcher_id, dispatcher_name, trip_id, driver_id, action_type, note, meta",
      )
      .eq("trip_id", bookingId)
      .order("created_at", { ascending: true });

    if (dispatchActionsRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "DISPATCH_ACTIONS_FAILED",
          message: dispatchActionsRes.error.message,
        },
        { status: 500 },
      );
    }

    const walletTransactionsRes = await supabase
      .from("driver_wallet_transactions")
      .select(
        "id, driver_id, amount, balance_after, reason, booking_id, created_at, wallet_settlement_id",
      )
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });

    if (walletTransactionsRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_WALLET_TRANSACTIONS_FAILED",
          message: walletTransactionsRes.error.message,
        },
        { status: 500 },
      );
    }

    const walletLedgerRes = await supabase
      .from("driver_wallet_ledger")
      .select(
        "id, driver_id, payout_request_id, booking_id, amount, entry_type, note, created_at",
      )
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });

    if (walletLedgerRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_WALLET_LEDGER_FAILED",
          message: walletLedgerRes.error.message,
        },
        { status: 500 },
      );
    }

    const dispatchActionRows = asArray<any>(dispatchActionsRes.data);
    const walletTransactionRows = asArray<any>(walletTransactionsRes.data);
    const walletLedgerRows = asArray<any>(walletLedgerRes.data);

    let passenger: any = null;
    if (booking?.created_by_user_id) {
      const passengerRes = await supabase
        .from("passenger_profiles")
        .select("user_id, full_name, phone, email, town_origin, barangay_origin")
        .eq("user_id", booking.created_by_user_id)
        .limit(1);
      if (passengerRes.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "PASSENGER_PROFILE_LOOKUP_FAILED",
            message: passengerRes.error.message,
          },
          { status: 500 },
        );
      }
      passenger = asArray<any>(passengerRes.data)[0] || null;
    }

    const attachedDriverId = text(booking?.driver_id || booking?.assigned_driver_id);
    let driverProfile: any = null;
    let driverAccount: any = null;
    if (attachedDriverId) {
      const driverProfileRes = await supabase
        .from("driver_profiles")
        .select("driver_id, full_name, callsign, phone, municipality, vehicle_type, plate_number, toda_org, is_toda_member")
        .eq("driver_id", attachedDriverId)
        .limit(1);
      if (driverProfileRes.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "DRIVER_PROFILE_LOOKUP_FAILED",
            message: driverProfileRes.error.message,
          },
          { status: 500 },
        );
      }
      driverProfile = asArray<any>(driverProfileRes.data)[0] || null;

      const driverAccountRes = await supabase
        .from("drivers")
        .select("id, driver_name, driver_status, roster_status, wallet_balance, min_wallet_required, wallet_locked, toda_name")
        .eq("id", attachedDriverId)
        .limit(1);
      if (driverAccountRes.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "DRIVER_ACCOUNT_LOOKUP_FAILED",
            message: driverAccountRes.error.message,
          },
          { status: 500 },
        );
      }
      driverAccount = asArray<any>(driverAccountRes.data)[0] || null;
    }

    let vendor: any = null;
    let takeoutItems: any[] = [];
    let errandJob: any = null;
    let errandStops: any[] = [];
    let errandFundEvents: any[] = [];
    let errandRouteAdjustments: any[] = [];
    let errandOfferOutcomes: any[] = [];
    const serviceTimelineRows: any[] = [];

    if (serviceType === "takeout") {
      if (booking?.vendor_id) {
        const vendorRes = await supabase
          .from("vendor_accounts")
          .select("id, display_name, town, location_label, vendor_location_label, accepting_orders")
          .eq("id", booking.vendor_id)
          .limit(1);
        if (vendorRes.error) {
          return NextResponse.json(
            {
              ok: false,
              error: "TAKEOUT_VENDOR_LOOKUP_FAILED",
              message: vendorRes.error.message,
            },
            { status: 500 },
          );
        }
        vendor = asArray<any>(vendorRes.data)[0] || null;
      }

      const itemsRes = await supabase
        .from("takeout_order_items")
        .select("id, booking_id, menu_item_id, name, price, quantity, snapshot_at")
        .eq("booking_id", bookingId)
        .order("id", { ascending: true });
      if (itemsRes.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "TAKEOUT_ITEMS_LOOKUP_FAILED",
            message: itemsRes.error.message,
          },
          { status: 500 },
        );
      }
      takeoutItems = asArray<any>(itemsRes.data);

      const takeoutMilestones = [
        [booking?.vendor_accepted_at, "vendor_accepted", "vendor"],
        [booking?.takeout_fee_proposed_at, "driver_fee_proposed", "driver"],
        [booking?.takeout_customer_confirmed_at, "customer_confirmed", "customer"],
        [booking?.vendor_driver_arrived_at, "rider_arrived_vendor", "driver"],
        [booking?.vendor_order_picked_at, "picked_up", "driver"],
      ] as const;

      for (const [at, action, actor] of takeoutMilestones) {
        if (!at) continue;
        serviceTimelineRows.push(
          timelineItem(at, "bookings_takeout_milestone", actor, action, { field_timestamp: at }, null, action),
        );
      }
    }

    if (serviceType === "errand") {
      const errandJobRes = await supabase
        .from("errand_jobs")
        .select("*")
        .eq("booking_id", bookingId)
        .limit(1);
      const errandStopsRes = await supabase
        .from("errand_stops")
        .select("*")
        .eq("booking_id", bookingId)
        .order("sequence", { ascending: true });
      const errandFundRes = await supabase
        .from("errand_pabili_fund_events")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true });
      const errandAdjustmentsRes = await supabase
        .from("errand_route_adjustments")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true });
      const errandOffersRes = await supabase
        .from("errand_driver_offer_outcomes")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true });

      const errandErrors = [
        errandJobRes.error,
        errandStopsRes.error,
        errandFundRes.error,
        errandAdjustmentsRes.error,
        errandOffersRes.error,
      ].filter(Boolean);
      if (errandErrors.length) {
        return NextResponse.json(
          {
            ok: false,
            error: "ERRAND_DETAIL_LOOKUP_FAILED",
            message: String((errandErrors[0] as any)?.message || errandErrors[0]),
          },
          { status: 500 },
        );
      }

      errandJob = asArray<any>(errandJobRes.data)[0] || null;
      errandStops = asArray<any>(errandStopsRes.data);
      errandFundEvents = asArray<any>(errandFundRes.data);
      errandRouteAdjustments = asArray<any>(errandAdjustmentsRes.data);
      errandOfferOutcomes = asArray<any>(errandOffersRes.data);

      if (errandJob) {
        const milestones = [
          [errandJob?.stage0_arrived_at, "stage0_arrived"],
          [errandJob?.pabili_cash_received_at, "pabili_cash_received"],
          [errandJob?.ready_for_customer_review_at, "ready_for_customer_review"],
          [errandJob?.task_confirmed_at, "task_confirmed"],
          [errandJob?.execution_started_at, "execution_started"],
          [errandJob?.final_arrived_at, "final_arrived"],
          [errandJob?.final_recipient_met_at, "final_recipient_met"],
          [errandJob?.handoff_completed_at, "handoff_completed"],
          [errandJob?.unreachable_escalated_at, "unreachable_escalated"],
          [errandJob?.escalation_resolution_started_at, "escalation_resolution_started"],
          [errandJob?.escalation_return_arrived_at, "escalation_return_arrived"],
          [errandJob?.escalation_resolution_completed_at, "escalation_resolution_completed"],
        ] as const;
        for (const [at, action] of milestones) {
          if (!at) continue;
          serviceTimelineRows.push(
            timelineItem(at, "errand_jobs", "system", action, errandJob, null, errandJob?.errand_stage ?? null),
          );
        }
      }

      for (const row of errandStops) {
        if (row?.arrived_at) {
          serviceTimelineRows.push(
            timelineItem(
              row.arrived_at,
              "errand_stops",
              "driver",
              "stop_" + String(row?.sequence ?? "") + "_arrived",
              row,
              null,
              row?.status ?? null,
            ),
          );
        }
        if (row?.completed_at) {
          serviceTimelineRows.push(
            timelineItem(
              row.completed_at,
              "errand_stops",
              "driver",
              "stop_" + String(row?.sequence ?? "") + "_completed",
              row,
              null,
              row?.status ?? null,
            ),
          );
        }
      }

      for (const row of errandFundEvents) {
        serviceTimelineRows.push(
          timelineItem(
            row?.created_at ?? null,
            "errand_pabili_fund_events",
            "driver/customer",
            text(row?.event_type || "pabili_fund_event"),
            row,
            null,
            null,
          ),
        );
      }

      for (const row of errandRouteAdjustments) {
        serviceTimelineRows.push(
          timelineItem(
            row?.confirmed_at || row?.created_at || null,
            "errand_route_adjustments",
            "driver/customer",
            "route_adjustment_" + text(row?.adjustment_type || row?.status || "event"),
            row,
            null,
            row?.status ?? null,
          ),
        );
      }

      for (const row of errandOfferOutcomes) {
        serviceTimelineRows.push(
          timelineItem(
            row?.created_at ?? null,
            "errand_driver_offer_outcomes",
            text(row?.driver_id || "dispatch"),
            "driver_offer_" + text(row?.outcome || "event"),
            row,
            null,
            row?.outcome ?? null,
          ),
        );
      }
    }

    const effectiveStatus =
      serviceType === "takeout"
        ? text(booking?.customer_status || booking?.vendor_status || booking?.driver_status || booking?.status).toLowerCase()
        : serviceType === "errand" && errandJob?.errand_stage
          ? text(errandJob.errand_stage).toLowerCase()
          : text(booking?.status).toLowerCase();

    const people = {
      passenger,
      driver: driverProfile,
      driver_account: driverAccount,
      vendor,
      producer: null,
    };

    const serviceDetails = {
      service_type: serviceType || text(booking?.trip_type).toLowerCase(),
      takeout: serviceType === "takeout"
        ? {
            vendor,
            items: takeoutItems,
            vendor_status: booking?.vendor_status ?? null,
            customer_status: booking?.customer_status ?? null,
            driver_status: booking?.driver_status ?? null,
            pricing_status: booking?.takeout_pricing_status ?? null,
            items_subtotal: booking?.takeout_items_subtotal ?? null,
            delivery_fee: booking?.takeout_delivery_fee ?? null,
            service_fee: booking?.takeout_service_fee ?? null,
            total_payable: booking?.takeout_total_payable ?? null,
          }
        : null,
      errand: serviceType === "errand"
        ? {
            job: errandJob,
            stops: errandStops,
            pabili_fund_events: errandFundEvents,
            route_adjustments: errandRouteAdjustments,
            driver_offer_outcomes: errandOfferOutcomes,
          }
        : null,
    };

    const timeline = [
      timelineItem(
        booking?.created_at ?? null,
        "bookings",
        "system",
        "booking_created",
        booking,
        null,
        null,
      ),
      ...dispatchActionRows.map((row) =>
        timelineItem(
          row?.created_at ?? null,
          "dispatch_actions",
          text(row?.dispatcher_name || row?.dispatcher_id || "system"),
          text(row?.action_type || "dispatch_action"),
          row,
          row?.meta?.from ?? null,
          row?.meta?.to ?? null,
        ),
      ),
      ...walletTransactionRows.map((row) =>
        timelineItem(
          row?.created_at ?? null,
          "driver_wallet_transactions",
          text(row?.driver_id || "wallet"),
          text(row?.reason || "wallet_transaction"),
          row,
          null,
          null,
        ),
      ),
      ...walletLedgerRows.map((row) =>
        timelineItem(
          row?.created_at ?? null,
          "driver_wallet_ledger",
          text(row?.driver_id || "wallet"),
          text(row?.entry_type || "wallet_ledger"),
          row,
          null,
          null,
        ),
      ),
      ...statusAuditRows.map((row) =>
        timelineItem(
          row?.created_at ?? null,
          "booking_status_audit",
          text(row?.actor_type || row?.source || "system"),
          "status_changed",
          row,
          row?.old_status ?? null,
          row?.new_status ?? null,
        ),
      ),
      ...adminAuditLogRows.map((row) =>
        timelineItem(
          row?.created_at ?? null,
          "admin_audit_log",
          text(row?.actor_email || row?.actor_id || "admin"),
          text(row?.action || "admin_action"),
          row,
          row?.from_status ?? null,
          row?.to_status ?? null,
        ),
      ),
      ...adminAuditLogsRows.map((row) =>
        timelineItem(
          row?.created_at ?? null,
          "admin_audit_logs",
          text(row?.actor || "admin"),
          text(row?.action || "admin_action"),
          row,
          null,
          null,
        ),
      ),
      ...serviceTimelineRows,
    ].sort((a, b) => ts(a.at) - ts(b.at));

    const diagnostics = [];
    const canonicalStatus = text(booking?.status).toLowerCase();
    const status = effectiveStatus || canonicalStatus;
    const hasAnyAdminAudit =
      adminAuditLogRows.length > 0 || adminAuditLogsRows.length > 0;
    const hasWalletEvidence =
      walletTransactionRows.length > 0 || walletLedgerRows.length > 0;

    if (!statusAuditRows.length) {
      diagnostics.push(
        diagnostic(
          "warn",
          "NO_BOOKING_STATUS_AUDIT",
          "No booking_status_audit rows found for this booking.",
          ["booking_status_audit count = 0"],
        ),
      );
    }

    if (!hasAnyAdminAudit) {
      diagnostics.push(
        diagnostic(
          "info",
          "NO_ADMIN_AUDIT",
          "No admin audit rows found in confirmed admin audit tables.",
          ["admin_audit_log count = 0", "admin_audit_logs count = 0"],
        ),
      );
    }

    if (status === "cancelled" && !hasAnyAdminAudit) {
      diagnostics.push(
        diagnostic(
          "warn",
          "CANCELLED_WITHOUT_ADMIN_AUDIT",
          "Booking is cancelled, but no confirmed admin audit row identifies an admin actor.",
          ["bookings.status = cancelled", "no admin audit rows"],
        ),
      );
    }

    if (
      statusAuditRows.length &&
      statusAuditRows.every(
        (row) =>
          text(row?.actor_type || row?.source).toLowerCase() === "system",
      )
    ) {
      diagnostics.push(
        diagnostic(
          "info",
          "SYSTEM_ONLY_STATUS_AUDIT",
          "All booking_status_audit rows are system sourced.",
          ["actor_type/source values are system only"],
        ),
      );
    }

    if (booking?.assigned_driver_id || booking?.driver_id) {
      diagnostics.push(
        diagnostic(
          "info",
          "DRIVER_ATTACHED",
          "Booking has a driver reference.",
          ["driver_id or assigned_driver_id is present"],
        ),
      );
    } else if (!["completed", "cancelled"].includes(status)) {
      diagnostics.push(
        diagnostic(
          "warn",
          "NO_DRIVER_ATTACHED",
          "Active booking has no driver reference.",
          ["driver_id is empty", "assigned_driver_id is empty"],
        ),
      );
    }

    if (
      status === "completed" &&
      text(booking?.driver_status).toLowerCase() === "on_trip"
    ) {
      diagnostics.push(
        diagnostic(
          "warn",
          "STALE_DRIVER_STATUS",
          "Booking is completed but driver_status is still on_trip.",
          ["bookings.status = completed", "bookings.driver_status = on_trip"],
        ),
      );
    }

    if (
      status === "completed" &&
      text(booking?.wallet_settlement_status).toLowerCase() !== "settled"
    ) {
      diagnostics.push(
        diagnostic(
          "warn",
          "WALLET_NOT_SETTLED",
          "Completed booking is not marked as wallet settled.",
          [
            "wallet_settlement_status = " +
              text(booking?.wallet_settlement_status),
          ],
        ),
      );
    }

    if (
      text(booking?.wallet_settlement_status).toLowerCase() === "settled" &&
      !booking?.wallet_settlement_id
    ) {
      diagnostics.push(
        diagnostic(
          "warn",
          "MISSING_SETTLEMENT_ID",
          "Wallet is settled but settlement ID is missing.",
          [
            "wallet_settlement_status = settled",
            "wallet_settlement_id is null",
          ],
        ),
      );
    }

    if (
      status === "completed" &&
      text(booking?.wallet_settlement_status).toLowerCase() === "settled" &&
      !hasWalletEvidence
    ) {
      diagnostics.push(
        diagnostic(
          "warn",
          "SETTLED_WITHOUT_WALLET_ROWS",
          "Booking is marked wallet settled, but no wallet transaction or ledger row was found for this booking.",
          [
            "wallet_settlement_status = settled",
            "driver_wallet_transactions count = 0",
            "driver_wallet_ledger count = 0",
          ],
        ),
      );
    }

    if (walletTransactionRows.length > 1) {
      diagnostics.push(
        diagnostic(
          "warn",
          "MULTIPLE_WALLET_TRANSACTIONS",
          "More than one driver wallet transaction exists for this booking.",
          [
            "driver_wallet_transactions count = " +
              String(walletTransactionRows.length),
          ],
        ),
      );
    }

    const acceptExpiry =
      booking?.takeout_driver_accept_expires_at ||
      booking?.driver_accept_expires_at ||
      null;
    if (
      acceptExpiry &&
      Date.parse(String(acceptExpiry)) < Date.now() &&
      ["assigned", "driver_assigned", "searching"].includes(status)
    ) {
      diagnostics.push(
        diagnostic(
          "warn",
          "DRIVER_ACCEPT_EXPIRED",
          "Driver accept timer is expired while booking is still not completed or cancelled.",
          ["accept expiry is in the past", "status = " + status],
        ),
      );
    }

    const feeExpiry =
      booking?.takeout_fee_expires_at ||
      booking?.takeout_fee_proposal_expires_at ||
      null;
    if (
      serviceType === "takeout" &&
      feeExpiry &&
      Date.parse(String(feeExpiry)) < Date.now() &&
      !["completed", "cancelled"].includes(status)
    ) {
      diagnostics.push(
        diagnostic(
          "warn",
          "TAKEOUT_FEE_EXPIRED",
          "Takeout fee timer is expired while booking is still open.",
          ["takeout fee expiry is in the past", "status = " + status],
        ),
      );
    }

    if (status === "completed" && booking?.company_cut == null) {
      diagnostics.push(
        diagnostic(
          "warn",
          "MISSING_COMPANY_CUT",
          "Completed booking has no company_cut value in bookings.",
          ["bookings.company_cut is null"],
        ),
      );
    }

    if (serviceType === "takeout" && canonicalStatus !== status) {
      diagnostics.push(
        diagnostic(
          "info",
          "TAKEOUT_OPERATIONAL_STATUS_DIFFERS",
          "Takeout operational status differs from the generic bookings.status field.",
          ["bookings.status = " + canonicalStatus, "operational_status = " + status],
        ),
      );
    }

    if (
      serviceType === "takeout" &&
      ["rider_arrived_vendor", "picked_up", "delivering"].includes(status)
    ) {
      const missingMilestones: string[] = [];
      if (["rider_arrived_vendor", "picked_up", "delivering"].includes(status) && !booking?.vendor_driver_arrived_at) {
        missingMilestones.push("vendor_driver_arrived_at");
      }
      if (["picked_up", "delivering"].includes(status) && !booking?.vendor_order_picked_at) {
        missingMilestones.push("vendor_order_picked_at");
      }
      if (missingMilestones.length) {
        diagnostics.push(
          diagnostic(
            "warn",
            "TAKEOUT_MILESTONE_TIMESTAMP_MISSING",
            "Takeout progressed beyond a milestone, but one or more dedicated milestone timestamps were not recorded.",
            missingMilestones,
          ),
        );
      }
    }

    if (serviceType === "errand" && !errandJob) {
      diagnostics.push(
        diagnostic(
          "warn",
          "ERRAND_JOB_NOT_FOUND",
          "Booking is marked as Errand but no errand_jobs row was found.",
          ["booking_id = " + bookingId],
        ),
      );
    }

    return NextResponse.json({
      ok: true,
      query: q,
      booking: {
        ...booking,
        effective_status: status,
      },
      people,
      service_details: serviceDetails,
      matches: bookingRows.map((row) => ({
        id: row?.id ?? null,
        booking_code: row?.booking_code ?? null,
        status: row?.status ?? null,
        service_type: row?.service_type ?? null,
        passenger_name: row?.passenger_name ?? null,
        town: row?.town ?? null,
        updated_at: row?.updated_at ?? null,
      })),
      timeline,
      diagnostics,
      raw: {
        booking: {
          ...booking,
          effective_status: status,
        },
        booking_status_audit: statusAuditRows,
        admin_audit_log: adminAuditLogRows,
        admin_audit_logs: adminAuditLogsRows,
        dispatch_actions: dispatchActionRows,
        driver_wallet_transactions: walletTransactionRows,
        driver_wallet_ledger: walletLedgerRows,
        takeout_order_items: takeoutItems,
        errand_job: errandJob,
        errand_stops: errandStops,
        errand_pabili_fund_events: errandFundEvents,
        errand_route_adjustments: errandRouteAdjustments,
        errand_driver_offer_outcomes: errandOfferOutcomes,
        people,
        service_details: serviceDetails,
        note: "Service-aware inspector includes Takeout items/vendor evidence, Errand execution evidence, and shared people/wallet/dispatch evidence.",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TICKET_INSPECTOR_FAILED",
        message: String(err?.message ?? err),
      },
      { status: 500 },
    );
  }
}
