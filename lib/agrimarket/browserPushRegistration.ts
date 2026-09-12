import { isFarmerAlertWorker } from "./browserAlertDevice";

export async function farmerPushSubscription(registration: ServiceWorkerRegistration, origin: string,
  publicKey: string, rejectedByPushService: boolean): Promise<PushSubscription> {
  if (!isFarmerAlertWorker(registration, origin)) throw new Error("The AgriMarket background worker is not ready.");
  const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
  let subscription = await registration.pushManager.getSubscription();
  const previousEndpoint = subscription?.endpoint;
  const previousKey = subscription?.options.applicationServerKey;
  const keyChanged = previousKey && (previousKey.byteLength !== bytes.byteLength
    || new Uint8Array(previousKey).some((value, index) => value !== bytes[index]));
  if (subscription && (rejectedByPushService || keyChanged)) {
    // This helper runs only from the user's Enable/Repair button. A rejected
    // endpoint must be removed before requesting a fresh browser subscription.
    await subscription.unsubscribe();
    subscription = await registration.pushManager.getSubscription();
    if (subscription) throw new Error("The browser kept the expired alert registration. It could not be repaired.");
  }
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  if (rejectedByPushService && previousEndpoint === subscription.endpoint) {
    throw new Error("The browser returned the same expired registration. Background alerts are still unavailable.");
  }
  return subscription;
}
