"use client";

import { useEffect, useRef, useState } from "react";
import { fareProposal, startFareReminders, type FareOrder } from "./fareProposal";

type Props = {
  order: FareOrder | null;
  lines: { label: string; amount: number }[];
  cashFirst?: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
};
const money = (n: number) => "PHP " + n.toFixed(2);

export default function TakeoutFareProposal({ order, lines, cashFirst, busy, error, onConfirm }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(true);
  const [sound, setSound] = useState<"starting" | "on" | "blocked">("starting");
  const dialog = useRef<HTMLDialogElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // The component can wait for a quote without ticking. Use fresh time on its
  // first render too, rather than the timestamp from when tracking was opened.
  const currentNow = Math.max(now, Date.now());
  const proposal = fareProposal(order, currentNow);
  const key = proposal?.key || "";
  const deadline = proposal?.deadline || 0;

  useEffect(() => {
    if (!key) return;
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
  }, [key, deadline]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (key && open && !el.open) el.showModal();
    if ((!key || !open) && el.open) el.close();
  }, [key, open]);

  async function enableSound() {
    if (!audio.current || !fareProposal(order)) return;
    try { await audio.current.play(); setSound("on"); }
    catch { setSound("blocked"); }
  }

  if (!proposal) return null;
  const seconds = Math.max(0, Math.ceil((deadline - currentNow) / 1000));
  const countdown = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  return <>
    <aside className="jride-fare-dock" aria-label="Pending Takeout total">
      <div><strong>Confirm your Takeout total</strong><span>{money(proposal.total)} | {countdown} left</span></div>
      <button type="button" className="jride-fare-primary" onClick={() => setOpen(true)}>Review total</button>
    </aside>
    <dialog ref={dialog} className="jride-fare-dialog" aria-labelledby="jride-fare-title" aria-describedby="jride-fare-description"
      onCancel={event => { event.preventDefault(); if (!busy) setOpen(false); }}>
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
        {sound === "blocked" ? <button type="button" className="jride-fare-secondary" onClick={enableSound}>Enable sound</button> : null}
        {error ? <p role="alert" className="jride-fare-error">{error}</p> : null}
      </div>
      <footer className="jride-fare-footer">
        <button type="button" className="jride-fare-primary" disabled={busy} onClick={() => { if (!busy && fareProposal(order)) onConfirm(); }}>
          {busy ? "Confirming..." : "Confirm " + money(proposal.total)}
        </button>
        <button type="button" className="jride-fare-secondary" disabled={busy} onClick={() => setOpen(false)}>Review later</button>
      </footer>
    </dialog>
  </>;
}
