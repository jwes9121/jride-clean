import { NextRequest } from "next/server";
import {
  agrimarketDisabledResponse,
  agrimarketEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketProducer,
} from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type HandlingTier = "standard" | "bulky" | "live_single" | "live_difficult";

function minimumHandlingTier(items: any[]): HandlingTier {
  let rank = 0;
  for (const item of items) {
    const cargoClass = String(item?.cargo_class || "").trim().toLowerCase();
    if (cargoClass === "live_livestock") rank = Math.max(rank, 2);
    else if (new Set(["crate", "bulk_sack", "live_poultry"]).has(cargoClass)) rank = Math.max(rank, 1);
  }
  return rank >= 2 ? "live_single" : rank >= 1 ? "bulky" : "standard";
}

export async function GET(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const producerAuth = await requireAgrimarketProducer(req);
    if (producerAuth.ok === false) return producerAuth.response;

    const admin = createServiceSupabase();
    const expiryRes = await admin.rpc("agrimarket_expire_pending_orders_v1", {
      p_now: new Date().toISOString(),
      p_limit: 200,
    });

    if (expiryRes.error) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_TIMEOUT_SWEEP_FAILED",
        message: "Agrimarket order expiry processing is temporarily unavailable.",
      });
    }

    const ordersRes = await admin
      .from("agrimarket_orders")
      .select(
        "id,order_code,status,fulfillment_mode,harvest_expected_start_at,harvest_expected_end_at,harvest_ready_at,producer_confirm_expires_at,producer_responded_at,producer_accepted_at,producer_rejected_at,producer_timeout_at,preparation_minutes,ready_at,preferred_vehicle_type,required_vehicle_type,estimated_cargo_weight_kg,confirmed_cargo_weight_basis,confirmed_cargo_weight_kg,confirmed_cargo_weight_band,confirmed_handling_tier,product_subtotal,delivery_fee,marketplace_fee,producer_product_net,producer_paid_at,producer_paid_amount,handling_fee,total_payable,picked_up_at,delivered_at,completed_at,created_at,updated_at"
      )
      .eq("producer_id", producerAuth.producer.id)
      .in("status", [
        "awaiting_producer",
        "awaiting_harvest",
        "producer_accepted",
        "preparing",
        "awaiting_customer_reapproval",
        "ready_for_dispatch",
        "dispatching",
        "driver_assigned",
        "picked_up",
        "delivering",
        "delivered",
        "completed",
      ])
      .order("created_at", { ascending: false })
      .limit(100);

    if (ordersRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_ORDERS_FAILED",
        message: ordersRes.error.message,
      });
    }

    const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
    const orderIds = orders.map((row: any) => String(row.id || "")).filter(Boolean);
    const itemsByOrder = new Map<string, any[]>();
    const proposalByOrder = new Map<string, any>();

    if (orderIds.length) {
      const [itemsRes, proposalsRes] = await Promise.all([
        admin
          .from("agrimarket_order_items")
          .select(
            "order_id,product_id,product_name,product_group,species,breed,meat_cut,processing_form,condition_required,cargo_class,selling_unit,unit_price,quantity,line_total,handling_eligible,availability_mode,harvest_start_at,harvest_end_at,harvest_order_cutoff_at"
          )
          .in("order_id", orderIds)
          .order("created_at", { ascending: true }),
        admin
          .from("agrimarket_harvest_proposals")
          .select("id,order_id,proposal_type,status,proposed_items,proposed_harvest_start_at,proposed_harvest_end_at,producer_reason,proposed_at")
          .in("order_id", orderIds)
          .eq("status", "pending_customer")
          .order("proposed_at", { ascending: false }),
      ]);

      if (itemsRes.error) {
        return jsonNoStore(500, {
          ok: false,
          error: "AGRIMARKET_PRODUCER_ORDER_ITEMS_FAILED",
          message: itemsRes.error.message,
        });
      }
      if (proposalsRes.error) {
        return jsonNoStore(500, {
          ok: false,
          error: "AGRIMARKET_HARVEST_PROPOSAL_READ_FAILED",
          message: proposalsRes.error.message,
        });
      }

      for (const item of (Array.isArray(itemsRes.data) ? itemsRes.data : []) as any[]) {
        const orderId = String(item.order_id || "");
        if (!orderId) continue;
        const list = itemsByOrder.get(orderId) || [];
        list.push({
          product_id: item.product_id,
          product_name: item.product_name,
          product_group: item.product_group,
          species: item.species,
          breed: item.breed,
          meat_cut: item.meat_cut,
          processing_form: item.processing_form,
          condition_required: item.condition_required,
          cargo_class: item.cargo_class,
          selling_unit: item.selling_unit,
          unit_price: Number(item.unit_price || 0),
          quantity: Number(item.quantity || 0),
          line_total: Number(item.line_total || 0),
          handling_eligible: Boolean(item.handling_eligible),
          availability_mode: item.availability_mode,
          harvest_start_at: item.harvest_start_at,
          harvest_end_at: item.harvest_end_at,
          harvest_order_cutoff_at: item.harvest_order_cutoff_at,
        });
        itemsByOrder.set(orderId, list);
      }

      for (const proposal of (Array.isArray(proposalsRes.data) ? proposalsRes.data : []) as any[]) {
        const orderId = String(proposal.order_id || "");
        if (orderId && !proposalByOrder.has(orderId)) {
          proposalByOrder.set(orderId, {
            id: proposal.id,
            proposal_type: proposal.proposal_type,
            status: proposal.status,
            proposed_items: Array.isArray(proposal.proposed_items) ? proposal.proposed_items : [],
            proposed_harvest_start_at: proposal.proposed_harvest_start_at,
            proposed_harvest_end_at: proposal.proposed_harvest_end_at,
            producer_reason: proposal.producer_reason,
            proposed_at: proposal.proposed_at,
          });
        }
      }
    }

    const nowMs = Date.now();
    const safeOrders = orders.map((row: any) => {
      const deadlineMs = new Date(String(row.producer_confirm_expires_at || "")).getTime();
      const secondsRemaining = Number.isFinite(deadlineMs)
        ? Math.max(0, Math.floor((deadlineMs - nowMs) / 1000))
        : 0;
      const productSubtotal = Number(row.product_subtotal || 0);
      const orderItems = itemsByOrder.get(String(row.id)) || [];

      return {
        order_code: row.order_code,
        status: row.status,
        fulfillment_mode: row.fulfillment_mode || "always_available",
        harvest_expected_start_at: row.harvest_expected_start_at,
        harvest_expected_end_at: row.harvest_expected_end_at,
        harvest_ready_at: row.harvest_ready_at,
        pending_harvest_proposal: proposalByOrder.get(String(row.id)) || null,
        producer_confirm_expires_at: row.producer_confirm_expires_at,
        confirmation_seconds_remaining: secondsRemaining,
        producer_responded_at: row.producer_responded_at,
        producer_accepted_at: row.producer_accepted_at,
        producer_rejected_at: row.producer_rejected_at,
        producer_timeout_at: row.producer_timeout_at,
        preparation_minutes: row.preparation_minutes,
        ready_at: row.ready_at,
        preferred_vehicle_type: row.preferred_vehicle_type,
        required_vehicle_type: row.required_vehicle_type,
        estimated_cargo_weight_kg: row.estimated_cargo_weight_kg == null ? null : Number(row.estimated_cargo_weight_kg),
        confirmed_cargo_weight_basis: row.confirmed_cargo_weight_basis || null,
        confirmed_cargo_weight_kg: row.confirmed_cargo_weight_kg == null ? null : Number(row.confirmed_cargo_weight_kg),
        confirmed_cargo_weight_band: row.confirmed_cargo_weight_band || null,
        confirmed_handling_tier: row.confirmed_handling_tier || null,
        minimum_handling_tier: minimumHandlingTier(orderItems),
        product_subtotal: productSubtotal,
        farmer_platform_fee: 0,
        producer_marketplace_commission: 0,
        producer_product_net: productSubtotal,
        farmer_receives_full_product_subtotal: true,
        producer_paid_at: row.producer_paid_at,
        producer_paid_amount: Number(row.producer_paid_amount || 0),
        producer_payment_status: row.producer_paid_at ? "paid" : "pending",
        customer_delivery_fee: Number(row.delivery_fee || 0),
        customer_handling_fee: Number(row.handling_fee || 0),
        customer_total_payable: Number(row.total_payable || 0),
        picked_up_at: row.picked_up_at,
        delivered_at: row.delivered_at,
        completed_at: row.completed_at,
        items: orderItems,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    return jsonNoStore(200, {
      ok: true,
      producer_id: producerAuth.producer.id,
      farmer_fee_policy: "free_launch_v1",
      farmer_wallet_enabled: false,
      joining_fee: 0,
      listing_fee: 0,
      marketplace_commission_percent: 0,
      marketplace_commission_is_customer_surcharge: false,
      orders: safeOrders,
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_PRODUCER_ORDERS_FAILED",
      message: String(error?.message || error),
    });
  }
}
