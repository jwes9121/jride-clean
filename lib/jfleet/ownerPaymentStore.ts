"use client";
import {checkedReceipt, paymentFields, paymentRequest, paymentScopeKey, samePayment,
  type PaymentFields, type PaymentReceipt, type PaymentRequest, type PaymentScope} from "./ownerPayment";
export type PaymentSlot = {
  version: 1; scope: PaymentScope; generation: string; phase: "draft" | "pending" | "confirmed";
  request: PaymentRequest | null; receipt: PaymentReceipt | null;
};
const DB = "jride-jfleet-owner-payments-v1", STORE = "requests";
function fresh(scope: PaymentScope): PaymentSlot {
  return {version: 1, scope, generation: crypto.randomUUID(), phase: "draft", request: null, receipt: null};
}
function validate(value: PaymentSlot, scope: PaymentScope): PaymentSlot {
  if (value.version !== 1 || paymentScopeKey(value.scope) !== paymentScopeKey(scope) || typeof value.generation !== "string" ||
      !["draft", "pending", "confirmed"].includes(value.phase)) throw new Error("Saved payment data is invalid. Do not clear it; contact JRide.");
  if (value.phase === "draft") {
    if (value.request || value.receipt) throw new Error("Saved payment state is invalid.");
  } else {
    const r = paymentRequest(value.request);
    if (r.booking_id !== scope.booking_id || r.expected_owner_id !== scope.owner_user_id || r.expected_partner_id !== scope.partner_id) throw new Error("Saved payment belongs to a different account.");
    if (value.phase === "confirmed") checkedReceipt(value.receipt, scope, r);
    else if (value.receipt) throw new Error("Saved payment state is invalid.");
  }
  return value;
}
async function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined" || typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") throw new Error("Secure saved-payment storage is unavailable. No payment was sent.");
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    let done = false;
    const timer = setTimeout(() => {done = true; reject(new Error("Saved-payment storage is blocked. Close other old tabs and retry."));}, 5000);
    req.onupgradeneeded = () => {if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);};
    req.onsuccess = () => {if (done) {req.result.close(); return;} done = true; clearTimeout(timer); resolve(req.result);};
    req.onerror = () => {done = true; clearTimeout(timer); reject(new Error("Could not open saved-payment storage. No new payment was sent."));};
  });
}
// Atomic read/modify/write serializes competing tabs. The HTTP call is made only AFTER oncomplete.
async function change(scope: PaymentScope, apply: (old: PaymentSlot | null) => PaymentSlot): Promise<PaymentSlot> {
  const key = paymentScopeKey(scope), db = await open();
  return new Promise((resolve, reject) => {
    let result: PaymentSlot, failure: unknown;
    let tx: IDBTransaction;
    try {tx = db.transaction(STORE, "readwrite", {durability: "strict"});}
    catch {db.close(); reject(new Error("Saved-payment storage is unavailable. No new payment was sent.")); return;}
    const store = tx.objectStore(STORE), req = store.get(key);
    req.onsuccess = () => {
      try {result = apply(req.result === undefined ? null : validate(req.result, scope)); store.put(result, key);}
      catch (e) {failure = e; tx.abort();}
    };
    tx.oncomplete = () => {db.close(); resolve(result);};
    tx.onabort = () => {db.close(); reject(failure || new Error("Payment could not be saved on this device. Do not create a replacement request."));};
    tx.onerror = () => { /* onabort is authoritative */ };
  });
}
export function readPaymentSlot(scope: PaymentScope): Promise<PaymentSlot> {
  return change(scope, old => old || fresh(scope));
}
export function preparePaymentSlot(scope: PaymentScope, generation: string, fields: PaymentFields): Promise<PaymentSlot> {
  const f = paymentFields(fields);
  return change(scope, old => {
    if (!old || old.generation !== generation) throw new Error("Another tab changed this payment form. Reload its saved request before continuing.");
    if (old.phase !== "draft") {
      if (!old.request || !samePayment(old.request, f)) throw new Error("A different payment request is already saved. Resolve that request first.");
      return old;
    }
    return {...old, phase: "pending", request: {...f, booking_id: scope.booking_id,
      expected_owner_id: scope.owner_user_id, expected_partner_id: scope.partner_id,
      idempotency_key: "JFP-" + crypto.randomUUID()}, receipt: null};
  });
}
export function confirmPaymentSlot(scope: PaymentScope, generation: string, req: PaymentRequest, receipt: unknown): Promise<PaymentSlot> {
  const r = checkedReceipt(receipt, scope, req);
  return change(scope, old => {
    if (!old || old.generation !== generation || old.request?.idempotency_key !== req.idempotency_key) throw new Error("The saved form changed on another tab. Reload; do not record this payment again.");
    return {...old, phase: "confirmed", receipt: r};
  });
}
export function nextPaymentSlot(scope: PaymentScope, generation: string): Promise<PaymentSlot> {
  return change(scope, old => {
    if (!old || old.generation !== generation || old.phase !== "confirmed") throw new Error("Resolve the saved payment before recording another payment.");
    return fresh(scope);
  });
}
