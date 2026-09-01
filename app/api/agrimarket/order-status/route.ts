import { NextRequest } from "next/server";
import {
  agrimarketDisabledResponse,
  agrimarketEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketPassenger,
} from "../_lib/server";

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

export async function GET(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const passengerAuth = await requireAgrimarketPassenger(req);
    if (passengerAuth.ok === false) return passengerAuth.response;

    const orderCode = text(req.nextUrl.searchParams.get("order_code") || req.nextUrl.searchParams.get("orderCode"));
    if (!orderCode) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_ORDER_CODE_REQUIRED",
        message: "order_code is required.",
      });
    }

    const admin = createServiceSupabase();
    const orderRes = await admin
      .from("agrimarket_orders")
      .select(
        "id,order_code,status,fulfillment_mode,harvest_expected_start_at,harvest_expected_end_at,harvest_ready_at,producer_confirm_expires_at,producer_responded_at,producer_accepted_at,producer_rejected_at,producer_timeout_at,preparation_minutes,ready_at,preferred_vehicle_type,required_vehicle_type,selected_vehicle_type,customer_approved_total,customer_approved_vehicle_type,customer_reapproval_required_at,customer_reapproval_responded_at,customer_reapproval_response,customer_reapproval_proposed_total,customer_reapproval_proposed_vehicle_type,customer_reapproval_resume_status,product_subtotal,estimated_cargo_weight_kg,confirmed_cargo_weight_basis,confirmed_cargo_weight_kg,confirmed_cargo_weight_band,confirmed_handling_tier,cash_collection_required,cash_collection_amount,customer_cash_collected_at,customer_cash_collected_amount,route_plan,assignment_anchor,route_distance_km,route_duration_seconds,delivery_base_fee,delivery_distance_fee,delivery_fee,driver_to_first_pickup_km,pickup_distance_fee,pickup_fee_locked_at,heavy_load_fee,handling_fee,handling_reason,handling_locked_at,total_payable,picked_up_at,delivering_at,delivered_at,completed_at,final_cash_collected_at,final_cash_collected_amount,created_at,updated_at"
      )
      .eq("order_code", orderCode)
      .eq("customer_user_id", passengerAuth.user.id)
      .limit(1)
      .maybeSingle();

    if (orderRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ORDER_STATUS_READ_FAILED",
        message: orderRes.error.message,
      });
    }
    if (!orderRes.data) {
      return jsonNoStore(404, {
        ok: false,
        error: "AGRIMARKET_ORDER_NOT_FOUND",
      });
    }

    const order: any = orderRes.data;
    const [itemsRes, proposalRes] = await Promise.all([
      admin
        .from("agrimarket_order_items")
        .select(
          "product_id,product_name,product_group,species,breed,meat_cut,processing_form,condition_required,cargo_class,selling_unit,unit_price,quantity,line_total,handling_eligible,availability_mode,harvest_start_at,harvest_end_at"
        )
        .eq("order_id", order.id)
        .order("created_at", { ascending: true }),
      admin
        .from("agrimarket_harvest_proposals")
        .select("id,proposal_type,status,proposed_items,proposed_harvest_start_at,proposed_harvest_end_at,producer_reason,proposed_at")
        .eq("order_id", order.id)
        .eq("status", "pending_customer")
        .order("proposed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (itemsRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ORDER_ITEMS_READ_FAILED",
        message: itemsRes.error.message,
      });
    }
    if (proposalRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_HARVEST_PROPOSAL_READ_FAILED",
        message: proposalRes.error.message,
      });
    }

    const collectedBeforeFarmer = num(order.customer_cash_collected_amount);
    const finalCashDue = Math.max(0, num(order.total_payable) - collectedBeforeFarmer);
    const status = text(order.status).toLowerCase();
    const cashDueNow =
      Boolean(order.cash_collection_required) && !order.customer_cash_collected_at && status === "driver_assigned"
        ? num(order.cash_collection_amount)
        : ["picked_up", "delivering"].includes(status)
          ? finalCashDue
          : 0;

    const proposal: any = proposalRes.data || null;
    const customerReapprovalRequired =
      status === "awaiting_customer_reapproval" &&
      order.customer_reapproval_response == null;
    const approvedTotal = num(order.customer_approved_total);
    const revisedTotal =
      order.customer_reapproval_proposed_total == null
        ? num(order.total_payable)
        : num(order.customer_reapproval_proposed_total);
    const approvedVehicleType =
      text(order.customer_approved_vehicle_type) || "motorcycle";
    const revisedVehicleType =
      text(order.customer_reapproval_proposed_vehicle_type) ||
      approvedVehicleType;
    const cargoBasis = text(order.confirmed_cargo_weight_basis).toLowerCase() || null;
    const cargoConfirmation = cargoBasis
      ? {
          weight_basis: cargoBasis,
          exact_weight_kg:
            cargoBasis === "exact" && order.confirmed_cargo_weight_kg != null
              ? num(order.confirmed_cargo_weight_kg)
              : null,
          weight_band:
            cargoBasis === "approximate"
              ? text(order.confirmed_cargo_weight_band) || null
              : null,
          handling_tier: text(order.confirmed_handling_tier) || null,
        }
      : null;
    const chargeBreakdown = {
      products: num(order.product_subtotal),
      delivery: num(order.delivery_fee),
      heavy_load_fee: num(order.heavy_load_fee),
      special_handling_fee: num(order.handling_fee),
      driver_approach_fee: num(order.pickup_distance_fee),
      driver_approach_fee_locked: order.pickup_fee_locked_at != null,
    };

    return jsonNoStore(200, {
      ok: true,
      order: {
        order_code: order.order_code,
        status: order.status,
        fulfillment_mode: order.fulfillment_mode || "always_available",
        harvest_expected_start_at: order.harvest_expected_start_at,
        harvest_expected_end_at: order.harvest_expected_end_at,
        harvest_ready_at: order.harvest_ready_at,
        pending_harvest_proposal: proposal
          ? {
              id: proposal.id,
              proposal_type: proposal.proposal_type,
              proposed_items: Array.isArray(proposal.proposed_items) ? proposal.proposed_items : [],
              proposed_harvest_start_at: proposal.proposed_harvest_start_at,
              proposed_harvest_end_at: proposal.proposed_harvest_end_at,
              reason: proposal.producer_reason,
              proposed_at: proposal.proposed_at,
              customer_response_required: true,
            }
          : null,
        producer_confirm_expires_at: order.producer_confirm_expires_at,
        producer_responded_at: order.producer_responded_at,
        producer_accepted_at: order.producer_accepted_at,
        producer_rejected_at: order.producer_rejected_at,
        producer_timeout_at: order.producer_timeout_at,
        preparation_minutes: order.preparation_minutes == null ? null : num(order.preparation_minutes),
        ready_at: order.ready_at,
        preferred_vehicle_type: order.preferred_vehicle_type,
        required_vehicle_type: order.required_vehicle_type,
        selected_vehicle_type: order.selected_vehicle_type,
        estimated_cargo_weight_kg:
          order.estimated_cargo_weight_kg == null ? null : num(order.estimated_cargo_weight_kg),
        confirmed_cargo_weight_basis: cargoBasis,
        confirmed_cargo_weight_kg:
          order.confirmed_cargo_weight_kg == null ? null : num(order.confirmed_cargo_weight_kg),
        confirmed_cargo_weight_band: text(order.confirmed_cargo_weight_band) || null,
        confirmed_handling_tier: text(order.confirmed_handling_tier) || null,
        cargo_confirmation: cargoConfirmation,
        customer_reapproval_required: customerReapprovalRequired,
        customer_reapproval: customerReapprovalRequired
          ? {
              approved_total: approvedTotal,
              revised_total: revisedTotal,
              increase_amount: Math.max(0, revisedTotal - approvedTotal),
              approved_vehicle_type: approvedVehicleType,
              revised_vehicle_type: revisedVehicleType,
              price_increased: revisedTotal > approvedTotal,
              vehicle_escalated:
                approvedVehicleType !== "tricycle" &&
                revisedVehicleType === "tricycle",
              required_at: order.customer_reapproval_required_at,
              confirmed_cargo: cargoConfirmation,
              charge_breakdown: chargeBreakdown,
            }
          : null,
        product_subtotal: num(order.product_subtotal),
        cash_collection_required: Boolean(order.cash_collection_required),
        cash_collection_amount: num(order.cash_collection_amount),
        customer_cash_collected_at: order.customer_cash_collected_at,
        customer_cash_collected_amount: collectedBeforeFarmer,
        route_plan: order.route_plan,
        assignment_anchor: order.assignment_anchor,
        service_route_distance_km: num(order.route_distance_km),
        service_route_duration_seconds: num(order.route_duration_seconds),
        delivery_base_fee: num(order.delivery_base_fee),
        delivery_distance_fee: num(order.delivery_distance_fee),
        delivery_fee: num(order.delivery_fee),
        driver_to_first_pickup_km:
          order.driver_to_first_pickup_km == null ? null : num(order.driver_to_first_pickup_km),
        pickup_distance_fee: num(order.pickup_distance_fee),
        pickup_fee_locked: order.pickup_fee_locked_at != null,
        pickup_fee_locked_at: order.pickup_fee_locked_at,
        heavy_load_fee: num(order.heavy_load_fee),
        heavy_load_fee_confirmed: cargoBasis != null,
        handling_fee: num(order.handling_fee),
        special_handling_fee: num(order.handling_fee),
        handling_reason: order.handling_reason,
        handling_fee_locked: order.handling_locked_at != null,
        special_handling_fee_confirmed: order.handling_locked_at != null,
        charge_breakdown: chargeBreakdown,
        total_payable: num(order.total_payable),
        cash_due_now: cashDueNow,
        final_cash_due: finalCashDue,
        final_cash_collected_at: order.final_cash_collected_at,
        final_cash_collected_amount: num(order.final_cash_collected_amount),
        picked_up_at: order.picked_up_at,
        delivering_at: order.delivering_at,
        delivered_at: order.delivered_at,
        completed_at: order.completed_at,
        items: Array.isArray(itemsRes.data) ? itemsRes.data : [],
        created_at: order.created_at,
        updated_at: order.updated_at,
      },
      producer_location_disclosure: "hidden",
      pickup_surcharge_status:
        order.pickup_fee_locked_at != null ? "final" : "pending_driver_assignment",
      driver_approach_fee_status:
        order.pickup_fee_locked_at != null ? "final" : "pending_driver_assignment",
      heavy_load_fee_status:
        cargoBasis != null ? "confirmed" : "pending_farmer_confirmation",
      handling_fee_status:
        order.handling_locked_at != null ? "final" : "pending_farmer_confirmation",
      special_handling_fee_status:
        order.handling_locked_at != null ? "confirmed" : "pending_farmer_confirmation",
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_ORDER_STATUS_FAILED",
      message: String(error?.message || error),
    });
  }
}
