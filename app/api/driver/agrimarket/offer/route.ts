import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import { agrimarketEnabled } from "@/app/api/agrimarket/_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function headers() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    Pragma: "no-cache",
  };
}

function requiredChecks(item: any): string[] {
  const checks = ["quantity"];
  if (text(item?.condition_required).toLowerCase() !== "normal") checks.push("condition");
  if (["bulk_sack", "crate", "live_fish", "live_poultry", "live_livestock"].includes(text(item?.cargo_class).toLowerCase())) {
    checks.push("cargo");
  }
  return checks;
}

function nextDriverAction(order: any): string | null {
  const status = text(order?.status).toLowerCase();
  if (status === "driver_assigned") {
    if (Boolean(order?.cash_collection_required) && !order?.customer_cash_collected_at) {
      return "collect_customer_cash";
    }
    if (!order?.producer_paid_at) return "pay_farmer";
    return "verify_pickup";
  }
  if (status === "picked_up") return "start_delivery";
  if (status === "delivering") return "confirm_delivery";
  if (status === "delivered") return "retry_settlement";
  return null;
}

export async function GET(req: Request) {
  if (!agrimarketEnabled()) {
    return NextResponse.json(
      { ok: false, error: "AGRIMARKET_DISABLED" },
      { status: 503, headers: headers() }
    );
  }

  try {
    const url = new URL(req.url);
    const explicitDriverId = text(url.searchParams.get("driver_id") || url.searchParams.get("driverId"));
    const identity = await resolveDriverRequest(req, explicitDriverId);
    if (!identity.ok || !identity.driverId) {
      return NextResponse.json(
        { ok: false, error: identity.error || "NOT_AUTHED" },
        { status: identity.status || 401, headers: headers() }
      );
    }

    const admin = supabaseAdmin();
    const nowIso = new Date().toISOString();

    await admin
      .from("agrimarket_driver_offers")
      .update({
        status: "expired",
        responded_at: nowIso,
        reason_code: "offer_timeout",
        updated_at: nowIso,
      })
      .eq("driver_id", identity.driverId)
      .eq("status", "offered")
      .lte("expires_at", nowIso);

    const offerRes = await admin
      .from("agrimarket_driver_offers")
      .select(
        "id,order_id,offer_rank,assignment_anchor,pickup_road_distance_km,pickup_distance_fee,estimated_seconds_to_first_pickup,estimated_seconds_to_farmer,offered_at,expires_at"
      )
      .eq("driver_id", identity.driverId)
      .eq("status", "offered")
      .gt("expires_at", nowIso)
      .order("offered_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (offerRes.error) {
      return NextResponse.json(
        { ok: false, error: "AGRIMARKET_DRIVER_OFFER_READ_FAILED", message: offerRes.error.message },
        { status: 500, headers: headers() }
      );
    }

    if (offerRes.data) {
      const offer: any = offerRes.data;
      const orderRes = await admin
        .from("agrimarket_orders")
        .select(
          "id,order_code,producer_id,status,product_subtotal,marketplace_fee,producer_product_net,cash_collection_required,cash_collection_amount,route_plan,assignment_anchor,preferred_vehicle_type,required_vehicle_type,route_distance_km,route_duration_seconds,delivery_fee,delivery_company_cut,handling_fee,preparation_minutes,ready_at"
        )
        .eq("id", offer.order_id)
        .limit(1)
        .maybeSingle();

      if (orderRes.error || !orderRes.data) {
        return NextResponse.json(
          { ok: false, error: "AGRIMARKET_OFFER_ORDER_READ_FAILED", message: orderRes.error?.message },
          { status: 500, headers: headers() }
        );
      }

      const [itemsRes, producerRes] = await Promise.all([
        admin
          .from("agrimarket_order_items")
          .select("product_name,product_group,species,breed,meat_cut,condition_required,cargo_class,selling_unit,quantity,handling_eligible")
          .eq("order_id", offer.order_id)
          .order("created_at", { ascending: true }),
        admin
          .from("agrimarket_producers")
          .select("town")
          .eq("id", (orderRes.data as any).producer_id)
          .limit(1)
          .maybeSingle(),
      ]);

      if (itemsRes.error || producerRes.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "AGRIMARKET_OFFER_DETAIL_READ_FAILED",
            message: itemsRes.error?.message || producerRes.error?.message,
          },
          { status: 500, headers: headers() }
        );
      }

      const order: any = orderRes.data;
      const estimatedEarningsBeforeHandling = Math.max(
        0,
        num(order.delivery_fee) + num(offer.pickup_distance_fee) - num(order.delivery_company_cut)
      );

      return NextResponse.json(
        {
          ok: true,
          auth_mode: identity.authMode,
          state: "offered",
          offer: {
            offer_id: offer.id,
            order_code: order.order_code,
            offer_rank: offer.offer_rank,
            assignment_anchor: offer.assignment_anchor,
            first_pickup: offer.assignment_anchor,
            pickup_area: offer.assignment_anchor === "farmer" ? (producerRes.data as any)?.town || null : null,
            pickup_road_distance_km: num(offer.pickup_road_distance_km),
            pickup_distance_fee: num(offer.pickup_distance_fee),
            eta_seconds_to_first_pickup: num(offer.estimated_seconds_to_first_pickup),
            eta_seconds_to_farmer: num(offer.estimated_seconds_to_farmer),
            route_plan: order.route_plan,
            cash_collection_required: Boolean(order.cash_collection_required),
            cash_collection_amount: num(order.cash_collection_amount),
            driver_cash_advance_required: !Boolean(order.cash_collection_required),
            farmer_payment_amount: num(order.producer_product_net),
            preferred_vehicle_type: order.preferred_vehicle_type,
            required_vehicle_type: order.required_vehicle_type,
            service_route_distance_km: num(order.route_distance_km),
            service_route_duration_seconds: num(order.route_duration_seconds),
            estimated_driver_earnings_before_handling: estimatedEarningsBeforeHandling,
            handling_may_apply: (Array.isArray(itemsRes.data) ? itemsRes.data : []).some(
              (item: any) => item.handling_eligible === true
            ),
            items: (Array.isArray(itemsRes.data) ? itemsRes.data : []).map((item: any) => ({
              product_name: item.product_name,
              product_group: item.product_group,
              species: item.species,
              breed: item.breed,
              meat_cut: item.meat_cut,
              condition_required: item.condition_required,
              cargo_class: item.cargo_class,
              selling_unit: item.selling_unit,
              quantity: num(item.quantity),
              handling_eligible: Boolean(item.handling_eligible),
              required_pickup_checks: requiredChecks(item),
              live_at_pickup_check_required: text(item.condition_required) === "live_at_pickup",
            })),
            offered_at: offer.offered_at,
            expires_at: offer.expires_at,
          },
          privacy: {
            farmer_identity_revealed: false,
            farmer_exact_location_revealed: false,
            customer_exact_location_revealed: false,
          },
        },
        { status: 200, headers: headers() }
      );
    }

    const assignedRes = await admin
      .from("agrimarket_orders")
      .select(
        "id,order_code,producer_id,status,product_subtotal,producer_product_net,cash_collection_required,cash_collection_amount,customer_cash_collected_at,customer_cash_collected_amount,producer_paid_at,producer_paid_amount,route_plan,assignment_anchor,delivery_label,delivery_lat,delivery_lng,preferred_vehicle_type,required_vehicle_type,route_distance_km,route_duration_seconds,pickup_distance_fee,handling_fee,handling_reason,handling_locked_at,total_payable,final_cash_collected_at,final_cash_collected_amount,wallet_settlement_status,wallet_settlement_amount,wallet_settlement_error,ready_at"
      )
      .eq("assigned_driver_id", identity.driverId)
      .in("status", ["driver_assigned", "picked_up", "delivering", "delivered"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (assignedRes.error) {
      return NextResponse.json(
        { ok: false, error: "AGRIMARKET_ACTIVE_ORDER_READ_FAILED", message: assignedRes.error.message },
        { status: 500, headers: headers() }
      );
    }

    if (!assignedRes.data) {
      return NextResponse.json(
        { ok: true, auth_mode: identity.authMode, state: "none", offer: null, order: null },
        { status: 200, headers: headers() }
      );
    }

    const order: any = assignedRes.data;
    const [producerRes, itemsRes, checksRes] = await Promise.all([
      admin
        .from("agrimarket_producers")
        .select("contact_name,town,barangay,pickup_label,pickup_lat,pickup_lng")
        .eq("id", order.producer_id)
        .limit(1)
        .maybeSingle(),
      admin
        .from("agrimarket_order_items")
        .select("id,product_name,product_group,species,breed,meat_cut,processing_form,condition_required,cargo_class,selling_unit,quantity,handling_eligible")
        .eq("order_id", order.id)
        .order("created_at", { ascending: true }),
      admin
        .from("agrimarket_pickup_checks")
        .select("order_item_id,check_type,result,observed_condition,notes,checked_at")
        .eq("order_id", order.id)
        .eq("driver_id", identity.driverId),
    ]);

    if (producerRes.error || !producerRes.data || itemsRes.error || checksRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "AGRIMARKET_ACTIVE_ORDER_DETAIL_FAILED",
          message: producerRes.error?.message || itemsRes.error?.message || checksRes.error?.message,
        },
        { status: 500, headers: headers() }
      );
    }

    const checksByItem = new Map<string, any[]>();
    for (const check of (Array.isArray(checksRes.data) ? checksRes.data : []) as any[]) {
      const itemId = text(check.order_item_id);
      const list = checksByItem.get(itemId) || [];
      list.push({
        check_type: check.check_type,
        result: check.result,
        observed_condition: check.observed_condition,
        notes: check.notes,
        checked_at: check.checked_at,
      });
      checksByItem.set(itemId, list);
    }

    const earlierCash = num(order.customer_cash_collected_amount);
    const finalCashDue = Math.max(0, num(order.total_payable) - earlierCash);

    return NextResponse.json(
      {
        ok: true,
        auth_mode: identity.authMode,
        state: "assigned",
        order: {
          order_code: order.order_code,
          status: order.status,
          next_action: nextDriverAction(order),
          route_plan: order.route_plan,
          assignment_anchor: order.assignment_anchor,
          cash_collection_required: Boolean(order.cash_collection_required),
          cash_collection_amount: num(order.cash_collection_amount),
          customer_cash_collected_at: order.customer_cash_collected_at,
          customer_cash_collected_amount: earlierCash,
          driver_cash_advance_required: !Boolean(order.cash_collection_required),
          farmer_payment_amount: num(order.producer_product_net),
          producer_paid_at: order.producer_paid_at,
          producer_paid_amount: num(order.producer_paid_amount),
          pickup_distance_fee: num(order.pickup_distance_fee),
          handling_fee: num(order.handling_fee),
          handling_reason: order.handling_reason,
          handling_locked: order.handling_locked_at != null,
          total_payable: num(order.total_payable),
          final_cash_due: finalCashDue,
          final_cash_collected_at: order.final_cash_collected_at,
          final_cash_collected_amount: num(order.final_cash_collected_amount),
          wallet_settlement_status: order.wallet_settlement_status,
          wallet_settlement_amount: num(order.wallet_settlement_amount),
          wallet_settlement_error: order.wallet_settlement_error,
          farmer: {
            name: (producerRes.data as any).contact_name,
            town: (producerRes.data as any).town,
            barangay: (producerRes.data as any).barangay,
            pickup_label: (producerRes.data as any).pickup_label,
            lat: num((producerRes.data as any).pickup_lat),
            lng: num((producerRes.data as any).pickup_lng),
          },
          customer_delivery: {
            label: order.delivery_label,
            lat: num(order.delivery_lat),
            lng: num(order.delivery_lng),
          },
          preferred_vehicle_type: order.preferred_vehicle_type,
          required_vehicle_type: order.required_vehicle_type,
          items: (Array.isArray(itemsRes.data) ? itemsRes.data : []).map((item: any) => ({
            ...item,
            required_pickup_checks: requiredChecks(item),
            live_at_pickup_check_required: text(item.condition_required) === "live_at_pickup",
            pickup_checks: checksByItem.get(text(item.id)) || [],
          })),
          ready_at: order.ready_at,
        },
        privacy: {
          farmer_identity_revealed: true,
          exact_locations_revealed_to_assigned_driver_only: true,
          disclosure_to_customer_or_other_parties_prohibited: true,
        },
      },
      { status: 200, headers: headers() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "AGRIMARKET_DRIVER_OFFER_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: headers() }
    );
  }
}
