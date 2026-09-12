import { AGRI_ALERT_SCOPE, AGRI_ALERT_WORKER } from "./browserAlerts";

export type AlertDeviceState = {
  permission: NotificationPermission | "unsupported";
  worker: "unsupported" | "missing" | "different" | "starting" | "ready" | "unavailable";
  subscription: "unknown" | "missing" | "present" | "unavailable";
};
export type AlertDevice = {
  origin: string;
  secure: boolean;
  permission: AlertDeviceState["permission"];
  workers?: Pick<ServiceWorkerContainer, "getRegistration">;
};

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("PHONE_CHECK_TIMEOUT")), 6000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function isFarmerAlertWorker(registration: ServiceWorkerRegistration | undefined, origin: string) {
  return Boolean(registration && registration.scope === new URL(AGRI_ALERT_SCOPE, origin).href
    && registration.active?.scriptURL === new URL(AGRI_ALERT_WORKER, origin).href);
}

// Read-only inspection: never requests permission, registers, subscribes, or sends data.
export async function inspectAlertDevice(device: AlertDevice): Promise<AlertDeviceState> {
  const state: AlertDeviceState = { permission: device.permission, worker: "unsupported", subscription: "unknown" };
  if (!device.secure || !device.workers) return state;
  let registration: ServiceWorkerRegistration | undefined;
  try { registration = await bounded(device.workers.getRegistration(AGRI_ALERT_SCOPE)); }
  catch { return { ...state, worker: "unavailable" }; }
  if (!registration) return { ...state, worker: "missing" };
  if (!registration.active) return { ...state, worker: "starting" };
  if (!isFarmerAlertWorker(registration, device.origin)) return { ...state, worker: "different" };
  state.worker = "ready";
  try { state.subscription = await bounded(registration.pushManager.getSubscription()) ? "present" : "missing"; }
  catch { state.subscription = "unavailable"; }
  return state;
}

// An explicit local test, separate from Firebase transport and from any order.
export async function testPhoneNotification(device: AlertDevice): Promise<void> {
  if (!device.secure || !device.workers || device.permission !== "granted") throw new Error("PHONE_PERMISSION_REQUIRED");
  const registration = await bounded(device.workers.getRegistration(AGRI_ALERT_SCOPE));
  if (!isFarmerAlertWorker(registration, device.origin)) throw new Error("FARMER_WORKER_REQUIRED");
  const options: NotificationOptions & { renotify: boolean } = {
    body: "Immediate phone notification test. No order or driver dispatch was created.",
    tag: "agrimarket-phone-test", renotify: true, requireInteraction: true,
    data: { order_code: "" },
  };
  await bounded(registration!.showNotification("AgriMarket phone test", options));
}
