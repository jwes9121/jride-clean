import { PAYMENT_KEY } from "./ownerPayment";

export type AddonPaymentScope = {
  owner_user_id: string;
  partner_id: string;
  booking_id: string;
  addon_id: string;
};

export type AddonPaymentFields = {
  amount: number;
  payment_channel: string;
  payment_reference: string;
  notes: string;
};

export type AddonPaymentRequest = AddonPaymentFields & {
  booking_id: string;
  addon_id: string;
  idempotency_key: string;
  expected_owner_id?: string;
  expected_partner_id?: string;
};

export type AddonPaymentReceipt = AddonPaymentFields & AddonPaymentScope & {
  payment_id: string;
  idempotency_key: string;
  status: "confirmed";
  confirmed_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid additional-charge payment request.");
  }
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max) {
    throw new Error("Additional-charge payment details are invalid or too long.");
  }
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function addonPaymentScope(value: unknown): AddonPaymentScope {
  const v = record(value);
  for (const key of ["owner_user_id", "partner_id", "booking_id", "addon_id"]) {
    if (typeof v[key] !== "string" || !UUID.test(v[key] as string)) {
      throw new Error("Additional-charge payment account context is unavailable. Reload the owner portal.");
    }
  }
  return {
    owner_user_id: v.owner_user_id as string,
    partner_id: v.partner_id as string,
    booking_id: v.booking_id as string,
    addon_id: v.addon_id as string,
  };
}

export function addonPaymentFields(value: unknown): AddonPaymentFields {
  const v = record(value);
  const amount = v.amount;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0.01 ||
    amount > 100000000 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001
  ) {
    throw new Error("The additional charge amount is invalid.");
  }
  return {
    amount: Math.round(amount * 100) / 100,
    payment_channel: cleanText(v.payment_channel, 80),
    payment_reference: cleanText(v.payment_reference, 180),
    notes: cleanText(v.notes, 1000),
  };
}

export function addonPaymentRequest(value: unknown): AddonPaymentRequest {
  const v = record(value);
  if (typeof v.booking_id !== "string" || !UUID.test(v.booking_id)) {
    throw new Error("Choose a valid booking.");
  }
  if (typeof v.addon_id !== "string" || !UUID.test(v.addon_id)) {
    throw new Error("Choose a valid additional charge.");
  }
  if (typeof v.idempotency_key !== "string" || !PAYMENT_KEY.test(v.idempotency_key)) {
    throw new Error("A saved additional-charge payment key is required. Reload the owner portal; do not create a replacement entry.");
  }
  for (const key of ["expected_owner_id", "expected_partner_id"]) {
    if (
      v[key] !== undefined &&
      (typeof v[key] !== "string" || !UUID.test(v[key] as string))
    ) {
      throw new Error("Additional-charge payment account context is invalid.");
    }
  }
  return {
    ...addonPaymentFields(v),
    booking_id: v.booking_id,
    addon_id: v.addon_id,
    idempotency_key: v.idempotency_key,
    ...(v.expected_owner_id === undefined
      ? {}
      : { expected_owner_id: v.expected_owner_id as string }),
    ...(v.expected_partner_id === undefined
      ? {}
      : { expected_partner_id: v.expected_partner_id as string }),
  };
}

export function addonPaymentScopeKey(value: AddonPaymentScope): string {
  const scope = addonPaymentScope(value);
  return [
    scope.owner_user_id,
    scope.partner_id,
    scope.booking_id,
    scope.addon_id,
  ].join(":");
}

export function sameAddonPayment(
  a: AddonPaymentFields,
  b: AddonPaymentFields
): boolean {
  return (
    a.amount === b.amount &&
    a.payment_channel === b.payment_channel &&
    a.payment_reference === b.payment_reference &&
    a.notes === b.notes
  );
}

export function checkedAddonReceipt(
  value: unknown,
  scope: AddonPaymentScope,
  expectedAmount: number
): AddonPaymentReceipt {
  const v = record(value);
  const savedScope = addonPaymentScope(v);
  const fields = addonPaymentFields(v);
  if (
    addonPaymentScopeKey(savedScope) !== addonPaymentScopeKey(scope) ||
    fields.amount !== expectedAmount ||
    typeof v.idempotency_key !== "string" ||
    !PAYMENT_KEY.test(v.idempotency_key) ||
    v.status !== "confirmed" ||
    typeof v.payment_id !== "string" ||
    !UUID.test(v.payment_id) ||
    typeof v.confirmed_at !== "string" ||
    !Number.isFinite(Date.parse(v.confirmed_at))
  ) {
    throw new Error("The server receipt does not match this additional charge. Keep the record and contact JRide.");
  }
  return {
    ...savedScope,
    ...fields,
    payment_id: v.payment_id,
    idempotency_key: v.idempotency_key,
    status: "confirmed",
    confirmed_at: v.confirmed_at,
  };
}
