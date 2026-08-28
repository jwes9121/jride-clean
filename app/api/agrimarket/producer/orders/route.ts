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
        "id,order_code,status,producer_confirm_expires_at,producer_responded_at,producer_accepted_at,producer_rejected_at,producer_timeout_at,preparation_minutes,preferred_vehicle_type,required_vehicle_type,product_subtotal,delivery_fee,marketplace_fee,producer_product_net,handling_fee,total_payable,created_at,updated_at"
      )
      .eq("producer_id", producerAuth.producer.id)
      .in("status", ["awaiting_producer", "producer_accepted", "preparing", "ready_for_dispatch"])
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

    if (orderIds.length) {
      const itemsRes = await admin
        .from("agrimarket_order_items")
        .select(
          "order_id,product_name,product_group,species,breed,meat_cut,processing_form,condition_required,cargo_class,selling_unit,unit_price,quantity,line_total,handling_eligible"
        )
        .in("order_id", orderIds)
        .order("created_at", { ascending: true });

      if (itemsRes.error) {
        return jsonNoStore(500, {
          ok: false,
          error: "AGRIMARKET_PRODUCER_ORDER_ITEMS_FAILED",
          message: itemsRes.error.message,
        });
      }

      for (const item of (Array.isArray(itemsRes.data) ? itemsRes.data : []) as any[]) {
        const orderId = String(item.order_id || "");
        if (!orderId) continue;
        const list = itemsByOrder.get(orderId) || [];
        list.push({
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
        });
        itemsByOrder.set(orderId, list);
      }
    }

    const nowMs = Date.now();
    const safeOrders = orders.map((row: any) => {
      const deadlineMs = new Date(String(row.producer_confirm_expires_at || "")).getTime();
      const secondsRemaining = Number.isFinite(deadlineMs)
        ? Math.max(0, Math.floor((deadlineMs - nowMs) / 1000))
        : 0;

      return {
        order_code: row.order_code,
        status: row.status,
        producer_confirm_expires_at: row.producer_confirm_expires_at,
        confirmation_seconds_remaining: secondsRemaining,
        producer_responded_at: row.producer_responded_at,
        producer_accepted_at: row.producer_accepted_at,
        producer_rejected_at: row.producer_rejected_at,
        producer_timeout_at: row.producer_timeout_at,
        preparation_minutes: row.preparation_minutes,
        preferred_vehicle_type: row.preferred_vehicle_type,
        required_vehicle_type: row.required_vehicle_type,
        product_subtotal: Number(row.product_subtotal || 0),
        producer_marketplace_commission: Number(row.marketplace_fee || 0),
        producer_product_net: Number(row.producer_product_net || 0),
        customer_delivery_fee: Number(row.delivery_fee || 0),
        customer_handling_fee: Number(row.handling_fee || 0),
        customer_total_payable: Number(row.total_payable || 0),
        items: itemsByOrder.get(String(row.id)) || [],
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    return jsonNoStore(200, {
      ok: true,
      producer_id: producerAuth.producer.id,
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
