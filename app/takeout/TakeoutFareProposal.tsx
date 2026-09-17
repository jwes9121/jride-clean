"use client";

import { useEffect, useRef, useState } from "react";
import { expectedFare, fareProposal, startFareReminders, type FareOrder } from "./fareProposal";

type Props = {
  order: FareOrder | null;
  lines: { label: string; amount: number }[];
  cashFirst?: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
};

const money = (n: number) => "PHP " + n.toFixed(2);

function currentPassengerAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof window === "undefined") return headers;

  const token =
    window.localStorage.getItem("jride_passenger_token") ||
    window.localStorage.getItem("jride_access_token") ||
    "";
  const nativeDeviceId =
    window.localStorage.getItem("jride_native_device_id") ||
    window.sessionStorage.getItem("jride_native_device_id") ||
    "";

  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  if (nativeDeviceId.trim()) headers["x-device-id"] = nativeDeviceId.trim();
  return headers;
}

async function declineTakeoutFare(order: FareOrder) {
  const res = await fetch("/api/takeout/decline-fee", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...currentPassengerAuthHeaders(),
    },
    body: JSON.stringify({
      order_id: order.id || undefined,
      booking_code: order.booking_code || order.code || undefined,
      action: "decline",
      expected_proposal: expectedFare(order),
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || "Failed to decline the delivery fare.");
  }
  return payload;
}

export default function TakeoutFareProposal({ order, lines, cashFirst, busy, error, onConfirm }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(true);
  const [sound, setSound] = useState<"starting" | "on" | "blocked">("starting");
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [declinedKey, setDeclinedKey] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const busyRef = useRef(busy || declining);
  busyRef.current = busy || declining;
  // The component can wait for a quote without ticking. Use fresh time on its
  // first render too, rather than the timestamp from when tracking was opened.
  const currentNow = Math.max(now, Date.now());
  const proposal = fareProposal(order, currentNow);
  const key = proposal?.key || "";
  const deadline = proposal?.deadline || 0;
  const activeKey = key && key !== declinedKey ? key : "";
  const actionBusy = busy || declining;

  useEffect(() => {
    if (!activeKey) return;
    setOpen(true);
    setSound("starting");
    const player = new Audio("/sounds/vendor-order-alert.mp3");
    player.preload = "auto";
    audio.current = player;
    let disposed = false;
    const play = () => {
      if (busyRef.current || Date.now() >= deadline) return;
      player.currentTime = 0;
      player.play().then(() => { if (!disposed) setSound("on"); })
        .catch(() => { if (!disposed) setSound("blocked"); });
    };
    const reminders = startFareReminders(deadline, play, () => {
      player.pause(); setNow(Date.now());
    });
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const resume = () => { setNow(Date.now()); reminders.check(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      disposed = true;
      reminders.stop(); window.clearInterval(tick);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      player.pause(); player.removeAttribute("src"); player.load();
      if (audio.current === player) audio.current = null;
    };
  }, [activeKey, deadline]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (activeKey && open && !el.open) el.showModal();
    if ((!activeKey || !open) && el.open) el.close();
  }, [activeKey, open]);

  async function enableSound() {
    if (!audio.current || !fareProposal(order) || declining) return;
    try { await audio.current.play(); setSound("on"); }
    catch { setSound("blocked"); }
  }

  async function handleDecline() {
    if (!order || !proposal || actionBusy) return;
    const confirmed = window.confirm(
      "Decline this delivery quote? This will cancel the entire Takeout order and release the driver."
    );
    if (!confirmed) return;

    setDeclining(true);
    setDeclineError(null);
    try {
      await declineTakeoutFare(order);
      setDeclinedKey(key);
      setOpen(false);
    } catch (e: any) {
      setDeclineError(String(e?.message || e || "Failed to decline the delivery fare."));
    } finally {
      setDeclining(false);
    }
  }

  if (!proposal) return null;

  if (declinedKey === key) {
    return (
      <aside className="jride-fare-dock" aria-live="polite">
        <div>
          <strong>Takeout order cancelled</strong>
          <span>The delivery quote was declined and the driver was released.</span>
        </div>
      </aside>
    );
  }

  const seconds = Math.max(0, Math.ceil((deadline - currentNow) / 1000));
  const countdown = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  return <>
    <aside className="jride-fare-dock" aria-label="Pending Takeout total">
      <div><strong>Confirm your Takeout total</strong><span>{money(proposal.total)} | {countdown} left</span></div>
      <button type="button" className="jride-fare-primary" onClick={() => setOpen(true)}>Review total</button>
    </aside>
    <dialog ref={dialog} className="jride-fare-dialog" aria-labelledby="jride-fare-title" aria-describedby="jride-fare-description"
      onCancel={event => { event.preventDefault(); if (!actionBusy) setOpen(false); }}>
      <header className="jride-fare-header">
        <div className="jride-fare-eyebrow">JRide Takeout | Action needed</div>
        <h2 id="jride-fare-title">Your delivery quote is ready</h2>
        <div className="jride-fare-total"><span>Total to pay</span><strong>{money(proposal.total)}</strong></div>
        <p id="jride-fare-description">Review and confirm before the timer ends.</p>
        <div className="jride-fare-timer" role="timer" aria-label={seconds + " seconds remaining"}>Time left <strong>{countdown}</strong></div>
      </header>
      <div className="jride-fare-body" tabIndex={0} aria-label="Bill breakdown">
        <dl>{lines.map(line => <div key={line.label}><dt>{line.label}</dt><dd>{money(line.amount)}</dd></div>)}</dl>
        {cashFirst ? <p className="jride-fare-note">The driver will collect cash from you before picking up from the store.</p> : null}
        <p className="jride-fare-sound">{sound === "on" ? "Sound reminders on: every 30 seconds until this quote expires." : sound === "blocked" ? "Sound is blocked. Tap Enable sound for reminders." : "Starting sound reminders..."}</p>
        {sound === "blocked" ? <button type="button" className="jride-fare-secondary" disabled={actionBusy} onClick={enableSound}>Enable sound</button> : null}
        {error || declineError ? <p role="alert" className="jride-fare-error">{declineError || error}</p> : null}
      </div>
      <footer className="jride-fare-footer">
        <button type="button" className="jride-fare-primary" disabled={actionBusy} onClick={() => { if (!actionBusy && fareProposal(order)) onConfirm(); }}>
          {actionBusy ? "Working..." : "Confirm " + money(proposal.total)}
        </button>
        <button type="button" className="jride-fare-secondary" disabled={actionBusy} onClick={() => void handleDecline()}>
          {declining ? "Cancelling..." : "Decline and cancel order"}
        </button>
        <button type="button" className="jride-fare-secondary" disabled={actionBusy} onClick={() => setOpen(false)}>Review later</button>
      </footer>
    </dialog>
  </>;
}
