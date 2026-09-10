"use client";

import { useEffect, useSyncExternalStore } from "react";

const SOUND_URL = "/sounds/vendor-order-alert.mp3";
const PREFERENCE_KEY = "JRIDE_VENDOR_ORDER_SOUND_V2";
const LEGACY_KEYS = ["JRIDE_VENDOR_ALERT_SOUND_ENABLED", "jride_vendor_sound_enabled"];
const REPEAT_MS = 30000;
type SoundStatus = "idle" | "starting" | "ready" | "blocked" | "error" | "off";
export type SoundOrder = { id: string; deadline: number };

// One audio element and schedule per document, shared by every vendor screen.
export function createVendorOrderSound() {
  let status: SoundStatus = "idle";
  let enabled = true;
  let initialized = false;
  let active = false;
  let vendor = "";
  let queue: SoundOrder[] = [];
  let knownIds = new Set<string>();
  let nextRingAt = 0;
  let audio: HTMLAudioElement | null = null;
  let playingForOrder = false;
  let inFlight = false;
  let generation = 0;
  let timeout: number | undefined;
  const listeners = new Set<() => void>();

  function publish(value: SoundStatus) {
    if (status === value) return;
    status = value;
    listeners.forEach((listener) => listener());
  }

  function readPreference() {
    try {
      const value = window.localStorage.getItem(PREFERENCE_KEY);
      if (value !== null) return value !== "0";
      const legacy = LEGACY_KEYS.map((key) => window.localStorage.getItem(key));
      // Reconcile the old independent screens. Fresh installs default to alerts on.
      return legacy.includes("1") || !legacy.includes("0");
    } catch {
      return enabled;
    }
  }

  function stopPlayback() {
    generation++;
    inFlight = false;
    playingForOrder = false;
    window.clearTimeout(timeout);
    if (audio) {
      audio.onerror = null;
      audio.onended = null;
      audio.pause();
      audio.currentTime = 0;
    }
  }

  function play(forOrder: boolean) {
    if (!active || !enabled || inFlight || (audio && !audio.paused)) return;
    const attempt = ++generation;
    nextRingAt = Date.now() + REPEAT_MS;
    inFlight = true;
    playingForOrder = forOrder;
    publish("starting");

    const failed = (error?: unknown) => {
      if (attempt !== generation || !active) return;
      const blocked = (error as { name?: string } | undefined)?.name === "NotAllowedError";
      stopPlayback();
      publish(blocked ? "blocked" : "error");
    };
    try {
      if (!audio) {
        audio = new Audio(SOUND_URL);
        audio.preload = "auto";
      }
      audio.muted = false;
      audio.volume = 1;
      audio.currentTime = 0;
      audio.onerror = () => failed();
      audio.onended = () => {
        if (attempt !== generation) return;
        playingForOrder = false;
        publish("ready");
      };
      timeout = window.setTimeout(() => failed(), 10000);
      // Call play synchronously here so the Enable/Test button retains its gesture.
      // Notification permission requests must not delay this call.
      const result = audio.play();
      void Promise.resolve(result).then(() => {
        if (attempt !== generation || !active || !enabled) return;
        window.clearTimeout(timeout);
        inFlight = false;
        publish("ready");
      }, failed);
    } catch (error) {
      failed(error);
    }
  }

  function update(vendorId: string, orders: SoundOrder[]) {
    if (!active) return;
    if (vendor !== vendorId) {
      stopPlayback();
      vendor = vendorId;
      knownIds.clear();
      nextRingAt = 0;
    }
    queue = vendorId ? orders.filter((order) => order.id && order.deadline > Date.now()) : [];
    const hasNewOrder = queue.some((order) => !knownIds.has(order.id));
    knownIds = new Set(queue.map((order) => order.id));
    if (!queue.length) {
      if (playingForOrder) stopPlayback();
      if (status === "starting") publish(enabled ? "idle" : "off");
      return;
    }
    if (enabled && (hasNewOrder || Date.now() >= nextRingAt)) play(true);
  }

  function persist(value: boolean) {
    enabled = value;
    try { window.localStorage.setItem(PREFERENCE_KEY, value ? "1" : "0"); } catch { /* Storage is optional. */ }
  }

  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== PREFERENCE_KEY) return;
    enabled = readPreference();
    if (!enabled) { stopPlayback(); publish("off"); }
    else { publish("idle"); nextRingAt = 0; update(vendor, queue); }
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getStatus: () => status,
    attach() {
      active = true;
      if (!initialized) { initialized = true; enabled = readPreference(); }
      if (!enabled) publish("off");
      window.addEventListener("storage", onStorage);
      return () => {
        active = false;
        stopPlayback();
        queue = [];
        window.removeEventListener("storage", onStorage);
      };
    },
    update,
    enableAndTest() {
      persist(true);
      // Permit an explicit retry immediately after a blocked or failed attempt.
      if (status === "starting") stopPlayback();
      play(queue.some((order) => order.deadline > Date.now()));
    },
    disable() { persist(false); stopPlayback(); publish("off"); },
  };
}

const sound = createVendorOrderSound();
const serverStatus = (): SoundStatus => "idle";

export function useVendorOrderSoundQueue(vendorId: string, orders: SoundOrder[]) {
  useEffect(() => sound.attach(), []);
  useEffect(() => { sound.update(vendorId, orders); }, [vendorId, orders]);
}

export function VendorOrderSoundControls() {
  const status = useSyncExternalStore(sound.subscribe, sound.getStatus, serverStatus);
  const needsEnable = status === "off" || status === "blocked" || status === "error";
  const message = status === "off" ? "Sound is off." : status === "blocked" ? "Sound blocked. Tap Enable sound."
    : status === "error" ? "Sound could not play. Tap Retry sound."
      : status === "starting" ? "Starting sound..." : "Sound on - alerts every 30 seconds while an order waits.";
  return (
    <div className="jride-order-sound" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span role="status" style={{ flexBasis: "100%", fontSize: 13 }}>{message}</span>
      <button type="button" onClick={() => sound.enableAndTest()}
        style={{ padding: "8px 12px", border: "1px solid #94a3b8", borderRadius: 8, fontWeight: 700 }}>
        {status === "error" ? "Retry sound" : needsEnable ? "Enable sound" : "Test sound"}
      </button>
      {!needsEnable ? <button type="button" onClick={() => sound.disable()}
        style={{ padding: "8px 12px", border: "1px solid #94a3b8", borderRadius: 8 }}>Mute sound</button> : null}
    </div>
  );
}
