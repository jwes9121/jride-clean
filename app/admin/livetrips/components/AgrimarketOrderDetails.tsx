import type { AgrimarketDispatchOrder } from "./AgrimarketDispatchPanel";

export type DispatchItem = {
  product_id?: string;
  product_name?: string;
  product_group?: string | null;
  species?: string | null;
  breed?: string | null;
  meat_cut?: string | null;
  processing_form?: string | null;
  condition_required?: string | null;
  cargo_class?: string | null;
  selling_unit?: string;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  harvest_start_at?: string | null;
  harvest_end_at?: string | null;
};

function label(value: unknown) {
  if (value == null || value === "") return "Not recorded";
  if (value === "kolong_kolong") return "Kolong-Kolong";
  if (value === "either") return "Any eligible vehicle";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}
function amount(value: unknown) {
  return value == null || value === "" || !Number.isFinite(Number(value)) ? "Not recorded" : `PHP ${Number(value).toFixed(2)}`;
}
function date(value: unknown) {
  if (!value) return "Not recorded";
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}
function route(km: unknown, seconds: unknown) {
  return `${km == null ? "Distance unavailable" : `${Number(km).toFixed(1)} km`} / ${seconds == null ? "Time unavailable" : `about ${Math.ceil(Number(seconds) / 60)} min driving`}`;
}
function weight(value: unknown) { return value == null ? "Not recorded" : `${value} kg`; }

export function AgrimarketOrderDetails({ order }: { order: AgrimarketDispatchOrder }) {
  const d = order.details || {};
  const customer = order.customer;
  const offer = order.latest_offer;
  const pinLat = Number(d.delivery_lat);
  const pinLng = Number(d.delivery_lng);
  const hasPin = d.delivery_lat != null && d.delivery_lng != null && Number.isFinite(pinLat) && Number.isFinite(pinLng) && Math.abs(pinLat) <= 90 && Math.abs(pinLng) <= 180 && (pinLat !== 0 || pinLng !== 0);
  const fees = [
    ["Products", order.product_subtotal], ["Delivery base", d.delivery_base_fee],
    ["Route distance fee", d.delivery_distance_fee], ["Delivery subtotal (base + distance)", order.delivery_fee],
    ["Driver approach / pickup", order.pickup_distance_fee], ["Heavy load", d.heavy_load_fee],
    ["Special handling", order.handling_fee], ["Customer total", order.total_payable],
  ] as const;
  const events = [
    ["Farmer reply deadline", order.producer_confirm_expires_at], ["Ready target", order.ready_at],
    ["Harvest / butchering start", order.harvest_expected_start_at], ["Harvest / butchering end", order.harvest_expected_end_at],
    ["Harvest ready", order.harvest_ready_at], ["Dispatch started", d.dispatch_started_at],
    ["Picked up", d.picked_up_at], ["Delivering", d.delivering_at], ["Delivered", d.delivered_at], ["Completed", d.completed_at],
  ] as const;
  return <details className="mt-3 rounded-lg border border-slate-200 p-3 text-xs">
    <summary className="cursor-pointer font-bold text-emerald-800">Order details{order.items?.length ? ` (${order.items.length} product lines)` : ""}</summary>
    <div className="mt-3 space-y-4 break-words">
      <section>
        <h3 className="font-bold">Products and cargo instructions</h3>
        {order.items?.length ? <ul className="mt-2 divide-y rounded-lg border">{order.items.map((item, index) => <li key={`${item.product_id || "item"}-${index}`} className="space-y-1 p-2">
          <div className="flex flex-wrap justify-between gap-2"><strong>{item.product_name || "Unnamed product"}</strong><strong>{amount(item.line_total)}</strong></div>
          <p>{item.quantity ?? "Quantity unavailable"} {item.selling_unit} x {amount(item.unit_price)}</p>
          <p className="text-slate-600">{[item.product_group, item.species, item.breed, item.meat_cut, item.processing_form, item.condition_required, item.cargo_class].filter(Boolean).map(label).join(" / ")}</p>
          {item.harvest_start_at && <p>Scheduled: {date(item.harvest_start_at)}{item.harvest_end_at ? ` to ${date(item.harvest_end_at)}` : ""}</p>}
        </li>)}</ul> : <p className="mt-1">Item details unavailable.</p>}
      </section>
      <section className="space-y-1">
        <h3 className="font-bold">Customer and destination</h3>
        <p>{customer?.name || "Name unavailable"} - Contact: {customer?.phone || "Not recorded"}</p>
        <p>Booked destination: {customer?.delivery_label || "Not recorded"}</p>
        <p>Saved address: {customer?.address_text || "Not recorded"}</p>
        <p>Saved landmark: {customer?.landmark || "Not recorded"}</p>
        {hasPin && <a className="inline-block font-semibold text-emerald-800 underline" href={`https://www.google.com/maps/search/?api=1&query=${pinLat},${pinLng}`} target="_blank" rel="noreferrer">Open booked delivery pin</a>}
        <p>Farmer: {order.farmer_area?.name || "Name unavailable"} - {[order.farmer_area?.barangay, order.farmer_area?.town].filter(Boolean).join(", ") || "Pickup area unavailable"}</p>
      </section>
      <section className="space-y-1">
        <h3 className="font-bold">Route and vehicle</h3>
        <p>First stop: {label(order.assignment_anchor)} / Plan: {label(order.route_plan)}</p>
        <p>Farmer to customer: {route(d.farmer_to_customer_distance_km, d.farmer_to_customer_duration_seconds)}</p>
        {order.cash_collection_required && <p>Customer to farmer: {route(d.customer_to_farmer_distance_km, d.customer_to_farmer_duration_seconds)}</p>}
        <p>Overall service route: {route(d.route_distance_km, d.route_duration_seconds)}</p>
        <p>Driver to first stop: {d.driver_to_first_pickup_km == null ? "Not recorded" : `${Number(d.driver_to_first_pickup_km).toFixed(1)} km`}</p>
        <p className="text-slate-500">Driving estimates exclude preparation and waiting. Route source: {label(d.route_provider)}.</p>
        <p>Required: <strong>{label(order.required_vehicle_type)}</strong> / Selected: {label(d.selected_vehicle_type)}</p>
        <p>Current preference: {label(order.preferred_vehicle_type)} / Checkout preference: {label(d.checkout_preferred_vehicle_type)} / Product minimum: {label(d.product_required_vehicle_type)}</p>
      </section>
      <section className="space-y-1">
        <h3 className="font-bold">Load confirmation</h3>
        <p>Checkout estimate: {weight(d.estimated_cargo_weight_kg)}</p>
        <p>Confirmed weight: {weight(d.confirmed_cargo_weight_kg)} / Basis: {label(d.confirmed_cargo_weight_basis)}</p>
        <p>Confirmed band: {d.confirmed_cargo_weight_band ? `${String(d.confirmed_cargo_weight_band).replace(/_/g, "-")} kg` : "Not recorded"} / Handling: {label(d.confirmed_handling_tier)}</p>
        <p>Handling reason: {label(d.handling_reason)}</p>
      </section>
      <section>
        <h3 className="font-bold">Fare breakdown</h3>
        <dl className="mt-2 space-y-1">{fees.map(([name, value]) => <div key={name} className={`flex flex-wrap justify-between gap-2 ${name === "Customer total" ? "border-t pt-2 font-bold" : ""}`}><dt>{name}</dt><dd>{amount(value)}</dd></div>)}</dl>
        <p className="mt-2 text-slate-500">Route rate: {amount(d.delivery_rate_per_km)} / km. {d.pickup_fee_locked_at ? `Approach fee locked ${date(d.pickup_fee_locked_at)}.` : "Approach fee is not locked; total may change with driver assignment."}</p>
        <p className="mt-1">Driver delivery payout: {amount(d.driver_delivery_payout)} / Delivery company cut: {amount(d.delivery_company_cut)}</p>
      </section>
      <section className="space-y-1">
        <h3 className="font-bold">Cash and settlement</h3>
        <p>{order.cash_collection_required ? `Cash-first: collect ${amount(order.cash_collection_amount)} from the customer before farmer pickup.` : "Farmer-first order."}</p>
        <p>Customer cash collected: {d.customer_cash_collected_at ? `${amount(d.customer_cash_collected_amount)} at ${date(d.customer_cash_collected_at)}` : "Not recorded"}</p>
        <p>Farmer paid: {d.producer_paid_at ? `${amount(d.producer_paid_amount)} at ${date(d.producer_paid_at)}` : "Not recorded"}</p>
        <p>Final cash collected: {d.final_cash_collected_at ? `${amount(d.final_cash_collected_amount)} at ${date(d.final_cash_collected_at)}` : "Not recorded"}</p>
        <p>Company settlement due: {amount(d.company_settlement_due)} / Wallet: {label(order.wallet_settlement_status)}</p>
      </section>
      <section className="space-y-1">
        <h3 className="font-bold">Customer approval</h3>
        <p>Approved amount: {amount(d.customer_approved_total)} / Vehicle: {label(d.customer_approved_vehicle_type)}</p>
        <p>{d.customer_reapproval_required_at ? `Reapproval requested ${date(d.customer_reapproval_required_at)} / Response: ${d.customer_reapproval_response == null ? "Pending" : label(d.customer_reapproval_response)}` : "No reapproval request recorded."}</p>
        {d.customer_reapproval_required_at && <p>Proposed: {amount(d.customer_reapproval_proposed_total)} / Vehicle: {label(d.customer_reapproval_proposed_vehicle_type)}</p>}
      </section>
      <section className="space-y-1">
        <h3 className="font-bold">Timing (Philippine time)</h3>
        <p>Preparation: {order.preparation_minutes == null ? "Not recorded" : `${order.preparation_minutes} min`}</p>
        {events.filter(([, value]) => value).map(([name, value]) => <p key={name}>{name}: {date(value)}</p>)}
        <p>Last updated: {date(order.updated_at)}</p>
      </section>
      {(offer || order.assigned_driver) && <section className="space-y-1">
        <h3 className="font-bold">Driver assignment</h3>
        {order.assigned_driver && <p>Assigned: {order.assigned_driver.name} / {label(order.assigned_driver.vehicle_type)} / {order.assigned_driver.municipality || "Town not recorded"}</p>}
        {offer && <><p>Latest offer: {offer.driver_name} / {label(offer.status)} / Rank {offer.offer_rank}</p><p>Offered: {date(offer.offered_at)} / Expires: {date(offer.expires_at)}</p><p>Offer reason: {label(offer.reason_code)}</p></>}
      </section>}
    </div>
  </details>;
}
