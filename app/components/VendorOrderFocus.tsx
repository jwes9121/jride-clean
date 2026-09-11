"use client";

import { acceptDeadline, canMarkReady, clean, countdown, orderBadge, orderKey, orderStage, orderStatus, shortOrderCode, type VendorOrder } from "@/lib/vendorOrderWorkflow";

type Props = {
  order: VendorOrder;
  active: VendorOrder[];
  now: number;
  disabled: boolean;
  savingId: string;
  driverPhone: string;
  onSelect: (id: string) => void;
  onAccept: () => void;
  onDecline: () => void;
  onReady: () => void;
  onItems: () => void;
};

export default function VendorOrderFocus({ order, active, now, disabled, savingId, driverPhone, onSelect, onAccept, onDecline, onReady, onItems }: Props) {
  const id = orderKey(order);
  const stage = orderStage(order);
  const pending = orderStatus(order) === "vendor_pending";
  const expired = pending && acceptDeadline(order) <= now;
  const hasItems = Array.isArray(order.items) && order.items.length > 0;
  const saving = savingId === id;
  return (
    <section className={"vendor-order-focus vendor-focus-" + (expired ? "danger" : stage.tone)} aria-label="Current order">
      {active.length > 1 ? (
        <label className="vendor-focus-picker" htmlFor="vendor-active-order">Current order ({active.length} active)
          <select id="vendor-active-order" value={id} disabled={!!savingId} onChange={event => onSelect(event.target.value)}>
            {active.map(item => <option key={orderKey(item)} value={orderKey(item)}>{shortOrderCode(item)} - {clean(item.customer_name || item.passenger_name) || "Customer"} - {orderBadge(item)}</option>)}
          </select>
        </label>
      ) : <div className="vendor-focus-identity"><span>{shortOrderCode(order)}</span><strong title={clean(order.customer_name || order.passenger_name)}>{clean(order.customer_name || order.passenger_name) || "Customer"}</strong></div>}
      <div className="vendor-focus-instruction" role="status" aria-atomic="true">
        <strong>{pending ? (expired ? "Acceptance window ended" : "New order - review items") : stage.title}</strong>
        <p>{pending ? (expired ? "Updating the final status. This order can no longer be accepted." : "Review the items below, then accept or decline.") : stage.note}</p>
      </div>
      {pending && !expired ? <p className="vendor-focus-countdown" aria-live="off">Accept within <strong>{countdown(order, now)}</strong></p> : null}
      <div className="vendor-focus-actions">
        {pending ? <>
          <button type="button" className="vendor-button vendor-button-primary" disabled={disabled || expired || !hasItems} onClick={onAccept}>{saving ? "Confirming..." : "Accept order"}</button>
          <button type="button" className="vendor-button vendor-button-danger" disabled={disabled || expired} onClick={onDecline}>Decline</button>
        </> : <>
          {canMarkReady(order) ? <button type="button" className="vendor-button vendor-button-primary" disabled={disabled || !hasItems} onClick={onReady}>{saving ? "Confirming..." : "Mark order ready"}</button> : <button type="button" className="vendor-button" onClick={onItems}>View items</button>}
          {driverPhone ? <a className="vendor-button" href={driverPhone}>Call driver</a> : null}
        </>}
      </div>
    </section>
  );
}
