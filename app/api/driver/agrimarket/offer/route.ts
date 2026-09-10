import { cargoConfirmation, requiredChecks, readAssignedAgrimarketState } from "@/lib/agrimarket/driverState";
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
    const identity = await resolveDriverRequest(req, explicitDriverId, { requireBearer: true });
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
          "id,order_code,producer_id,status,pickup_issue,product_subtotal,marketplace_fee,producer_product_net,cash_collection_required,cash_collection_amount,route_plan,assignment_anchor,preferred_vehicle_type,required_vehicle_type,product_required_vehicle_type,checkout_preferred_vehicle_type,route_distance_km,route_duration_seconds,delivery_fee,delivery_company_cut,pickup_distance_fee,heavy_load_fee,handling_fee,confirmed_cargo_weight_basis,confirmed_cargo_weight_kg,confirmed_cargo_weight_band,confirmed_handling_tier,preparation_minutes,ready_at"
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
      const estimatedEarningsBeforeHandling =
        Math.max(
          0,
          num(order.delivery_fee) + num(offer.pickup_distance_fee) - num(order.delivery_company_cut)
        ) + num(order.heavy_load_fee);
      const estimatedDriverEarnings = estimatedEarningsBeforeHandling + num(order.handling_fee);

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
            checkout_preferred_vehicle_type: order.checkout_preferred_vehicle_type,
            product_required_vehicle_type: order.product_required_vehicle_type,
            preferred_vehicle_type: order.preferred_vehicle_type,
            required_vehicle_type: order.required_vehicle_type,
            service_route_distance_km: num(order.route_distance_km),
            service_route_duration_seconds: num(order.route_duration_seconds),
            estimated_driver_earnings_before_handling: estimatedEarningsBeforeHandling,
            estimated_driver_earnings: estimatedDriverEarnings,
            heavy_load_fee: num(order.heavy_load_fee),
            special_handling_fee: num(order.handling_fee),
            handling_may_apply: (Array.isArray(itemsRes.data) ? itemsRes.data : []).some(
              (item: any) => item.handling_eligible === true
            ),
            cargo_confirmation: cargoConfirmation(order),
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
            farmer_contact_revealed: false,
            farmer_exact_location_revealed: false,
            customer_exact_location_revealed: false,
          },
        },
        { status: 200, headers: headers() }
      );
    }

    const current = await readAssignedAgrimarketState(admin, identity.driverId, identity.authMode);
    return NextResponse.json(current.body, { status: current.status, headers: headers() });

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
