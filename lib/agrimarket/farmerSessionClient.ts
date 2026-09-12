import { AGRI_ALERT_SCOPE } from "./browserAlerts";
import { isFarmerAlertWorker } from "./browserAlertDevice";

export const FARMER_CODE_KEY = "JRIDE_AGRIMARKET_ACCESS_CODE";
export const FARMER_PIN_KEY = "JRIDE_AGRIMARKET_ACCESS_PIN";
const SESSION_URL = "/api/agrimarket/producer/session";

export function farmerSessionHeaders(code = "", json = false): Record<string, string> {
  return { Accept: "application/json", "x-jride-agrimarket-session": "1",
    ...(code ? { "x-jride-agrimarket-code": code } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}
function saved(key: string) { try { return sessionStorage.getItem(key) || ""; } catch { return ""; } }
export function clearFarmerPin() { try { sessionStorage.removeItem(FARMER_PIN_KEY); } catch { /* No persistent PIN is written. */ } }
function rememberCode(code: string) {
  clearFarmerPin();
  try { sessionStorage.setItem(FARMER_CODE_KEY, code); } catch { /* The cookie remains the authentication source. */ }
  return code;
}
async function sessionRequest(method: string, body?: object, suffix = "") {
  const response = await fetch(SESSION_URL + suffix, { method, headers: farmerSessionHeaders("", Boolean(body)),
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(12000),
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(payload.message || "Could not restore farmer sign-in. Check your connection and try again.");
    Object.assign(failure, { status: response.status });
    throw failure;
  }
  if (!payload.ok) throw new Error("Farmer sign-in could not be confirmed.");
  return payload;
}
export async function signInFarmer(code: string, pin: string) {
  const result = await sessionRequest("POST", { access_code: code, pin });
  return rememberCode(result.access_code);
}
let restoring: Promise<string> | null = null;
export function restoreFarmerSession(): Promise<string> {
  if (restoring) return restoring;
  restoring = (async () => {
    try { return rememberCode((await sessionRequest("GET")).access_code); }
    catch (failure: any) {
      if (failure.status !== 401) throw failure;
      const code = saved(FARMER_CODE_KEY), pin = saved(FARMER_PIN_KEY);
      // Upgrade an already signed-in old tab once; never retry an old PIN on polling.
      clearFarmerPin();
      if (code && pin) return signInFarmer(code, pin);
      return "";
    }
  })().finally(() => { restoring = null; });
  return restoring;
}
export async function signOutFarmer(code: string) {
  let id = "";
  try { id = localStorage.getItem("AGRI_PUSH_V1:" + code) || ""; } catch { /* Optional registration hint. */ }
  await sessionRequest("DELETE", undefined, /^[a-f0-9-]{36}$/i.test(id) ? "?subscription_id=" + id : "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const cleanup = async () => {
      if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
      const worker = await navigator.serviceWorker.getRegistration(AGRI_ALERT_SCOPE);
      if (!isFarmerAlertWorker(worker, location.origin)) return;
      const subscription = await worker!.pushManager.getSubscription();
      if (!timedOut) await subscription?.unsubscribe();
    };
    await Promise.race([cleanup(), new Promise<void>(resolve => {
      timer = setTimeout(() => { timedOut = true; resolve(); }, 3000);
    })]);
  } catch { /* The server already disabled this registration and revoked the session. */ }
  finally { if (timer) clearTimeout(timer); }
  clearFarmerPin();
  try { sessionStorage.removeItem(FARMER_CODE_KEY); localStorage.removeItem("AGRI_PUSH_V1:" + code); } catch { /* Cookie was revoked. */ }
}
