"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AGRI_ALERT_REPEAT_MS, AGRI_ALERT_SCOPE, AGRI_ALERT_STALE_MS, AGRI_ALERT_WORKER,
  farmerOrderHref, pendingFarmerOrders, type PendingFarmerOrder } from "@/lib/agrimarket/browserAlerts";
import styles from "./farmer.module.css";

type Feed = { orders: PendingFarmerOrder[]; offset: number; received: number; publicKey: string | null;
  pushAvailable: boolean; subscription: null | { active: boolean; last_test: null | { status: string; last_error: string | null } } };
const EMPTY: Feed = { orders: [], offset: 0, received: 0, publicKey: null, pushAvailable: false, subscription: null };

function credentials() {
  return { code: sessionStorage.getItem("JRIDE_AGRIMARKET_ACCESS_CODE") || "", pin: sessionStorage.getItem("JRIDE_AGRIMARKET_ACCESS_PIN") || "" };
}
function headers() {
  const { code, pin } = credentials();
  return { "Content-Type": "application/json", "x-jride-agrimarket-code": code, "x-jride-agrimarket-pin": pin };
}
function stored(key: string) { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Session still works. */ } }

export default function FarmerOrderAlerts() {
  const [account, setAccount] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [browserSubscribed, setBrowserSubscribed] = useState(false);
  const [feed, setFeed] = useState<Feed>(EMPTY);
  const [now, setNow] = useState(0);
  const [visible, setVisible] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [sound, setSound] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const feedRef = useRef(feed);
  const soundRef = useRef(sound);
  const flight = useRef(false);
  const ringFlight = useRef(false);
  const soundTestUntil = useRef(0);
  const mounted = useRef(false);
  feedRef.current = feed;
  soundRef.current = sound;

  useEffect(() => {
    mounted.current = true;
    const code = credentials().code;
    setAccount(code);
    setSubscriptionId(stored("AGRI_PUSH_V1:" + code));
    setSound(stored("AGRI_SOUND_V1:" + code) === "on");
    try { setSnoozeUntil(Number(sessionStorage.getItem("AGRI_SNOOZE_V1:" + code)) || 0); } catch { /* Optional preference. */ }
    audio.current = new Audio("/sounds/vendor-order-alert.mp3");
    audio.current.preload = "auto";
    return () => { mounted.current = false; audio.current?.pause(); audio.current = null; };
  }, []);

  useEffect(() => {
    let disposed = false;
    const check = async () => {
      try {
        const registration = await navigator.serviceWorker?.getRegistration(AGRI_ALERT_SCOPE);
        const owned = registration?.active?.scriptURL === new URL(AGRI_ALERT_WORKER, location.origin).href;
        const subscription = owned ? await registration!.pushManager.getSubscription() : null;
        if (!disposed) setBrowserSubscribed(Boolean(subscription));
      } catch { if (!disposed) setBrowserSubscribed(false); }
    };
    void check();
    window.addEventListener("focus", check);
    return () => { disposed = true; window.removeEventListener("focus", check); };
  }, []);

  const refresh = useCallback(async () => {
    if (!account || flight.current) return;
    flight.current = true;
    try {
      const response = await fetch("/api/agrimarket/producer/alerts" + (subscriptionId ? "?subscription_id=" + subscriptionId : ""),
        { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        const authFailed = response.status === 401 || response.status === 403;
        if (authFailed && mounted.current) setFeed(EMPTY);
        throw new Error(authFailed ? "Sign in again to receive AgriMarket alerts." : "Order alerts are reconnecting. Keep checking Orders.");
      }
      if (!mounted.current) return;
      setFeed({ orders: Array.isArray(body.orders) ? body.orders : [], offset: Date.parse(body.server_time) - Date.now(),
        received: Date.now(), publicKey: body.public_key || null, pushAvailable: body.push_available === true,
        subscription: body.subscription || null });
      setError("");
    } catch (failure: any) { if (mounted.current) setError(failure.message || "Order alerts are reconnecting."); }
    finally { flight.current = false; }
  }, [account, subscriptionId]);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 10000);
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    const push = (event: MessageEvent) => { if (event.data?.type === "jride-agrimarket-refresh") void refresh(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    navigator.serviceWorker?.addEventListener("message", push);
    return () => { clearInterval(poll); window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus); navigator.serviceWorker?.removeEventListener("message", push); };
  }, [refresh]);

  useEffect(() => {
    const tick = () => {
      const time = Date.now();
      setNow(time);
      setVisible(document.visibilityState === "visible");
      setPermission("Notification" in window ? Notification.permission : "unsupported");
      const current = feedRef.current;
      const pending = pendingFarmerOrders(current.orders, time + current.offset);
      const fresh = current.received > 0 && time - current.received <= AGRI_ALERT_STALE_MS;
      if (soundTestUntil.current > time && document.visibilityState === "visible" && soundRef.current) return;
      if (!fresh || !pending.length || document.visibilityState !== "visible" || !soundRef.current) {
        audio.current?.pause();
        return;
      }
      if (ringFlight.current) return;
      const ringKey = "AGRI_RING_V1:" + account + ":" + pending[0].order_code;
      const ring = async () => {
        if (time - Number(stored(ringKey) || 0) < AGRI_ALERT_REPEAT_MS) return;
        save(ringKey, String(time));
        try { if (audio.current) { audio.current.currentTime = 0; await audio.current.play(); } }
        catch { if (mounted.current) { setSound(false); setMessage("Tap Enable sound to allow the order ringtone."); } }
      };
      ringFlight.current = true;
      const operation = navigator.locks
        ? navigator.locks.request("agrimarket-order-sound", { ifAvailable: true }, lock => lock ? ring() : undefined)
        : ring();
      void operation.finally(() => { ringFlight.current = false; });
    };
    tick();
    const clock = window.setInterval(tick, 1000);
    return () => clearInterval(clock);
  }, [account]);

  const fresh = now > 0 && feed.received > 0 && now - feed.received <= AGRI_ALERT_STALE_MS;
  const pending = fresh ? pendingFarmerOrders(feed.orders, now + feed.offset) : [];
  const open = visible && pending.length > 0 && now >= snoozeUntil;
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  async function enableSound() {
    try {
      if (!audio.current) return;
      soundTestUntil.current = Date.now() + 8000;
      soundRef.current = true;
      audio.current.currentTime = 0;
      await audio.current.play();
      setSound(true); save("AGRI_SOUND_V1:" + account, "on");
      setMessage("Sound test playing. While this page is active, new orders ring every 30 seconds until their deadline.");
    } catch { setSound(false); setMessage("Sound was blocked. Check this browser's sound permission and media volume."); }
  }
  async function action(body: object) {
    const response = await fetch("/api/agrimarket/producer/alerts", { method: "POST", headers: headers(),
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || "Alert setup failed.");
    return payload;
  }
  async function enablePush() {
    if (!feed.publicKey || !feed.pushAvailable) { setMessage("Background alerts are not configured yet. Foreground sound is still available."); return; }
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setMessage("This browser does not support background alerts. On iPhone, add the site to the Home Screen and open it there."); return;
    }
    setBusy(true);
    try {
      // Explicit gesture only. Never register, request permission or change login on polling.
      const allowed = await Notification.requestPermission();
      setPermission(allowed);
      if (allowed !== "granted") throw new Error("Notifications are blocked. Allow them in this site's browser settings.");
      const registration = await navigator.serviceWorker.register(AGRI_ALERT_WORKER, { scope: AGRI_ALERT_SCOPE, updateViaCache: "none" });
      if (!registration.active) await new Promise<void>((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        const timeout = window.setTimeout(() => reject(new Error("Alert setup took too long. Try again.")), 10000);
        if (!worker) { clearTimeout(timeout); reject(new Error("Alert worker is not ready.")); return; }
        const changed = () => { if (worker.state === "activated") { clearTimeout(timeout); worker.removeEventListener("statechange", changed); resolve(); } };
        worker.addEventListener("statechange", changed); changed();
      });
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const base64 = feed.publicKey.replace(/-/g, "+").replace(/_/g, "/");
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      }
      const result = await action({ action: "subscribe", subscription: subscription.toJSON() });
      setBrowserSubscribed(true);
      setSubscriptionId(result.subscription.id); save("AGRI_PUSH_V1:" + account, result.subscription.id);
      setMessage("Browser registered. Use Test background alert, then lock the phone to check delivery and sound.");
      void refresh();
    } catch (failure: any) { setMessage(failure.message || "Background alerts could not be enabled."); }
    finally { setBusy(false); }
  }
  async function testPush() {
    setBusy(true);
    try { await action({ action: "test", subscription_id: subscriptionId });
      setMessage("Test queued. Lock the phone now. Allow up to 90 seconds. No order or driver dispatch was created."); void refresh(); }
    catch (failure: any) { setMessage(failure.message); }
    finally { setBusy(false); }
  }
  async function disablePush() {
    setBusy(true);
    try {
      await action({ action: "unsubscribe", subscription_id: subscriptionId });
      const registration = await navigator.serviceWorker.getRegistration(AGRI_ALERT_SCOPE);
      if (registration?.active?.scriptURL === new URL(AGRI_ALERT_WORKER, location.origin).href) {
        await (await registration.pushManager.getSubscription())?.unsubscribe();
      }
      setSubscriptionId(""); save("AGRI_PUSH_V1:" + account, "");
      setBrowserSubscribed(false);
      setMessage("Background alerts disabled on this browser."); void refresh();
    } catch (failure: any) { setMessage(failure.message); }
    finally { setBusy(false); }
  }
  const registered = Boolean(subscriptionId && browserSubscribed && feed.subscription?.active && permission === "granted");
  const lastTest = feed.subscription?.last_test;
  function dismiss() {
    const until = Date.now() + AGRI_ALERT_REPEAT_MS;
    setSnoozeUntil(until);
    try { sessionStorage.setItem("AGRI_SNOOZE_V1:" + account, String(until)); } catch { /* In-page snooze still works. */ }
  }

  return <section className={styles.alertPanel} aria-label="AgriMarket order alerts">
    <strong>Order alerts</strong>
    <p>Page sound: {sound ? "enabled" : "off"}. Background alerts: {registered ? "registered" : permission === "denied" ? "blocked by browser" : "not enabled"}.</p>
    <div className={styles.alertButtons}>
      <button type="button" onClick={() => void enableSound()}>{sound ? "Test sound" : "Enable sound"}</button>
      {sound && <button type="button" onClick={() => { setSound(false); audio.current?.pause(); save("AGRI_SOUND_V1:" + account, "off"); }}>Mute page sound</button>}
      <button type="button" disabled={busy} onClick={() => void enablePush()}>{registered ? "Refresh alert registration" : "Enable background alerts"}</button>
      <button type="button" disabled={busy || !registered} onClick={() => void testPush()}>Test background alert</button>
      {registered && <button type="button" disabled={busy} onClick={() => void disablePush()}>Disable background alerts</button>}
    </div>
    <p className={styles.alertNote}>Background notification sound depends on your phone settings. Repeated page sound requires an active browser page.</p>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {lastTest && <p>Last background test: {lastTest.status === "sent" ? "accepted by the push service; confirm it arrived on your phone" : lastTest.status}.</p>}
    <dialog ref={dialog} className={styles.alertDialog} onCancel={event => { event.preventDefault(); dismiss(); }} aria-labelledby="agri-incoming-title">
      <h2 id="agri-incoming-title">New AgriMarket order</h2>
      <p>{pending.length} order{pending.length === 1 ? "" : "s"} waiting for your response.</p>
      {pending.map(order => <div key={order.order_code} className={styles.alertOrder}><strong>{order.order_code}</strong>
        <p>Respond within {Math.max(0, Math.ceil((Date.parse(order.producer_confirm_expires_at) - now - feed.offset) / 1000))} seconds.</p>
        <a href={farmerOrderHref(order.order_code)} onClick={dismiss}>Review order</a></div>)}
      <button type="button" onClick={dismiss}>Remind me in 30 seconds</button>
    </dialog>
  </section>;
}
