"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { inspectAlertDevice, testPhoneNotification, type AlertDevice, type AlertDeviceState } from "@/lib/agrimarket/browserAlertDevice";
import styles from "./farmer.module.css";

function currentPhone(): AlertDevice {
  return { origin: location.origin, secure: window.isSecureContext,
    permission: "Notification" in window ? Notification.permission : "unsupported",
    workers: navigator.serviceWorker };
}

const permissionLabels = { granted: "Allowed by this browser", denied: "Blocked by this browser",
  default: "Permission has not been granted", unsupported: "Not supported in this browser" };
const workerLabels = { ready: "Ready", missing: "Missing on this phone", different: "AgriMarket worker was not found",
  starting: "Still starting", unavailable: "Could not check - try Check this phone", unsupported: "Not available in this browser" };
const subscriptionLabels = { present: "Present on this phone", missing: "Missing on this phone",
  unavailable: "Could not check - try Check this phone", unknown: "Not checked" };

export default function PhoneAlertCheck({ serverRegistered, onState }: {
  serverRegistered: boolean; onState: (state: AlertDeviceState) => void;
}) {
  const [state, setState] = useState<AlertDeviceState | null>(null);
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState("");
  const alive = useRef(false);
  const generation = useRef(0);
  const check = useCallback(async () => {
    const id = ++generation.current;
    setChecking(true);
    const inspected = await inspectAlertDevice(currentPhone());
    // A check started before registration or a return from sleep cannot overwrite a newer result.
    if (!alive.current || id !== generation.current) return;
    setState(inspected); onState(inspected); setChecking(false);
  }, [onState]);

  useEffect(() => {
    alive.current = true;
    const returned = () => { if (document.visibilityState === "visible") void check(); };
    void check();
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", returned);
    navigator.serviceWorker?.addEventListener("controllerchange", returned);
    return () => { alive.current = false; generation.current++;
      window.removeEventListener("focus", returned); document.removeEventListener("visibilitychange", returned);
      navigator.serviceWorker?.removeEventListener("controllerchange", returned); };
  }, [check, serverRegistered]);

  async function test() {
    setTesting(true); setResult("");
    try {
      await testPhoneNotification(currentPhone());
      if (alive.current) setResult("The browser accepted the phone notification. Check the notification tray and listen for sound. This does not confirm locked-screen delivery.");
    } catch (error: any) {
      const message = error?.message === "PHONE_PERMISSION_REQUIRED" ? "This browser has not allowed phone notifications."
        : error?.message === "FARMER_WORKER_REQUIRED" ? "The AgriMarket background worker is missing. Enable background alerts, then check this phone again."
        : error?.message === "PHONE_CHECK_TIMEOUT" ? "The phone notification check timed out. Its result is unknown."
        : "The browser could not display the phone notification. Check its notification permission in the phone settings.";
      if (alive.current) setResult(message);
    } finally { if (alive.current) { setTesting(false); void check(); } }
  }

  return <div aria-label="Phone notification checks">
    <strong>This phone</strong>
    <div className={styles.alertButtons}>
      <button type="button" disabled={checking} onClick={() => void check()}>{checking ? "Checking phone..." : "Check this phone"}</button>
      <button type="button" disabled={testing || checking} onClick={() => void test()}>Test phone notification now</button>
    </div>
    {state && <div aria-live="polite">
      <p>Notification permission: {permissionLabels[state.permission]}.</p>
      <p>Background worker: {workerLabels[state.worker]}.</p>
      <p>Push subscription: {subscriptionLabels[state.subscription]}.</p>
      <p>Server registration: {serverRegistered ? "active" : "not confirmed"}.</p>
    </div>}
    <p className={styles.alertNote}>Phone sound and lock-screen display still depend on the phone settings. The immediate test creates no order.</p>
    {result && <p role="status">{result}</p>}
  </div>;
}
