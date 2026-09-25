"use client";

import {
  addonPaymentFields,
  addonPaymentRequest,
  addonPaymentScopeKey,
  checkedAddonReceipt,
  type AddonPaymentFields,
  type AddonPaymentReceipt,
  type AddonPaymentRequest,
  type AddonPaymentScope,
} from "./ownerAddonPayment";

export type AddonPaymentSlot = {
  version: 1;
  scope: AddonPaymentScope;
  generation: string;
  phase: "draft" | "pending" | "confirmed";
  request: AddonPaymentRequest | null;
  receipt: AddonPaymentReceipt | null;
};

const DB = "jride-jfleet-owner-addon-payments-v1";
const STORE = "requests";

function fresh(scope: AddonPaymentScope): AddonPaymentSlot {
  return {
    version: 1,
    scope,
    generation: crypto.randomUUID(),
    phase: "draft",
    request: null,
    receipt: null,
  };
}

function validate(
  value: AddonPaymentSlot,
  scope: AddonPaymentScope,
  expectedAmount: number
): AddonPaymentSlot {
  if (
    value.version !== 1 ||
    addonPaymentScopeKey(value.scope) !== addonPaymentScopeKey(scope) ||
    typeof value.generation !== "string" ||
    !["draft", "pending", "confirmed"].includes(value.phase)
  ) {
    throw new Error("Saved additional-charge payment data is invalid. Do not clear it; contact JRide.");
  }

  if (value.phase === "draft") {
    if (value.request || value.receipt) {
      throw new Error("Saved additional-charge payment state is invalid.");
    }
  } else {
    const request = addonPaymentRequest(value.request);
    if (
      request.booking_id !== scope.booking_id ||
      request.addon_id !== scope.addon_id ||
      request.expected_owner_id !== scope.owner_user_id ||
      request.expected_partner_id !== scope.partner_id ||
      request.amount !== expectedAmount
    ) {
      throw new Error("Saved additional-charge payment belongs to a different account or amount.");
    }
    if (value.phase === "confirmed") {
      checkedAddonReceipt(value.receipt, scope, expectedAmount);
    } else if (value.receipt) {
      throw new Error("Saved additional-charge payment state is invalid.");
    }
  }
  return value;
}

async function openDb(): Promise<IDBDatabase> {
  if (
    typeof indexedDB === "undefined" ||
    typeof crypto === "undefined" ||
    typeof crypto.randomUUID !== "function"
  ) {
    throw new Error("Secure saved-payment storage is unavailable. No additional-charge payment was sent.");
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      reject(new Error("Saved add-on payment storage is blocked. Close old tabs and retry."));
    }, 5000);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      if (done) {
        request.result.close();
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      done = true;
      clearTimeout(timer);
      reject(new Error("Could not open saved add-on payment storage. No payment was sent."));
    };
  });
}

async function change(
  scope: AddonPaymentScope,
  expectedAmount: number,
  apply: (old: AddonPaymentSlot | null) => AddonPaymentSlot
): Promise<AddonPaymentSlot> {
  const key = addonPaymentScopeKey(scope);
  const db = await openDb();

  return new Promise((resolve, reject) => {
    let result: AddonPaymentSlot;
    let failure: unknown;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, "readwrite", { durability: "strict" });
    } catch {
      db.close();
      reject(new Error("Saved add-on payment storage is unavailable. No payment was sent."));
      return;
    }

    const store = tx.objectStore(STORE);
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        result = apply(
          request.result === undefined
            ? null
            : validate(request.result, scope, expectedAmount)
        );
        store.put(result, key);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ||
          new Error("Add-on payment could not be saved on this device. Do not create a replacement request.")
      );
    };
    tx.onerror = () => {};
  });
}

export function readAddonPaymentSlot(
  scope: AddonPaymentScope,
  expectedAmount: number
): Promise<AddonPaymentSlot> {
  return change(scope, expectedAmount, (old) => old || fresh(scope));
}

export function prepareAddonPaymentSlot(
  scope: AddonPaymentScope,
  expectedAmount: number,
  generation: string,
  fields: AddonPaymentFields
): Promise<AddonPaymentSlot> {
  const saved = addonPaymentFields(fields);
  if (saved.amount !== expectedAmount) {
    throw new Error("The additional charge changed. Reload before confirming payment.");
  }

  return change(scope, expectedAmount, (old) => {
    if (!old || old.generation !== generation) {
      throw new Error("Another tab changed this add-on payment form. Reload its saved state.");
    }
    if (old.phase !== "draft") return old;

    return {
      ...old,
      phase: "pending",
      request: {
        ...saved,
        booking_id: scope.booking_id,
        addon_id: scope.addon_id,
        expected_owner_id: scope.owner_user_id,
        expected_partner_id: scope.partner_id,
        idempotency_key: "JFAP-" + crypto.randomUUID(),
      },
      receipt: null,
    };
  });
}

export function confirmAddonPaymentSlot(
  scope: AddonPaymentScope,
  expectedAmount: number,
  generation: string,
  receiptValue: unknown
): Promise<AddonPaymentSlot> {
  const receipt = checkedAddonReceipt(receiptValue, scope, expectedAmount);
  return change(scope, expectedAmount, (old) => {
    if (!old || old.generation !== generation) {
      throw new Error("Another tab changed this add-on payment form. Reload before doing anything else.");
    }
    if (
      old.phase === "pending" &&
      old.request &&
      old.request.idempotency_key !== receipt.idempotency_key
    ) {
      // Another device/browser may already have recorded this one-time add-on.
      // The authoritative addon-bound receipt wins.
    }
    return { ...old, phase: "confirmed", request: old.request, receipt };
  });
}
