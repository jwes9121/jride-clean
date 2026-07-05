"use client";

import * as React from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { useParams } from "next/navigation";

type ScanState = "idle" | "starting" | "scanning" | "success" | "warning" | "error";

type ParsedPass = {
  registrationNumber: string;
  qrToken: string;
};

type CheckInResponse = {
  success: boolean;
  reason:
    | "checked_in"
    | "already_checked_in"
    | "invalid_token"
    | "pending_review"
    | "invalid_request"
    | "server_error";
  attendeeId?: string;
  fullName?: string;
  registrationNumber?: string;
  groupValue?: string;
  groupLabel?: string;
  checkedInAt?: string | null;
  status?: string;
  guests?: {
    attendeeId: string;
    fullName: string;
    registrationNumber: string;
    attendanceStatus: string;
    relationship: string;
  }[];
  message?: string;
};

function parsePassUrl(raw: string): ParsedPass | null {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const passIndex = parts.indexOf("pass");
    const registrationNumber = passIndex >= 0 ? parts[passIndex + 1] : "";
    const qrToken = url.searchParams.get("token") || "";

    if (!registrationNumber || !qrToken) return null;

    return {
      registrationNumber: decodeURIComponent(registrationNumber),
      qrToken,
    };
  } catch {
    return null;
  }
}

function beep(frequency = 880, durationMs = 120) {
  try {
    const AudioContextClass =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.08;

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      context.close();
    }, durationMs);
  } catch {}
}

function formatCheckedIn(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export default function EventScannerPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const lastScanRef = React.useRef("");
  const cooldownUntilRef = React.useRef(0);
  const checkingInRef = React.useRef(false);

  const [scanState, setScanState] = React.useState<ScanState>("idle");
  const [message, setMessage] = React.useState("Press Start Scanner to begin.");
  const [lastRaw, setLastRaw] = React.useState("");
  const [parsed, setParsed] = React.useState<ParsedPass | null>(null);
  const [result, setResult] = React.useState<CheckInResponse | null>(null);

  async function submitCheckIn(pass: ParsedPass) {
    if (checkingInRef.current) return;

    checkingInRef.current = true;
    setParsed(pass);
    setResult(null);
    setScanState("starting");
    setMessage("Checking Event Pass...");

    try {
      const res = await fetch(`/api/events/${eventSlug}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pass),
      });

      const data = (await res.json()) as CheckInResponse;
      setResult(data);

      if (data.success && data.reason === "checked_in") {
        setScanState("success");
        setMessage("Checked in successfully.");
        navigator.vibrate?.(120);
        beep(880, 120);
        return;
      }

      if (data.reason === "already_checked_in") {
        setScanState("warning");
        setMessage("Already checked in.");
        navigator.vibrate?.([100, 80, 100]);
        beep(520, 180);
        return;
      }

      if (data.reason === "pending_review") {
        setScanState("warning");
        setMessage("Needs Help Desk review.");
        navigator.vibrate?.([150, 100, 150]);
        beep(440, 220);
        return;
      }

      setScanState("error");
      setMessage(data.message || "Invalid Event Pass.");
      navigator.vibrate?.(300);
      beep(220, 250);
    } catch (error) {
      setScanState("error");
      setMessage(error instanceof Error ? error.message : "Check-in failed.");
      navigator.vibrate?.(300);
      beep(220, 250);
    } finally {
      checkingInRef.current = false;
    }
  }

  async function startScanner() {
    if (!videoRef.current) return;

    setScanState("starting");
    setMessage("Starting camera...");

    try {
      const reader = new BrowserMultiFormatReader();

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (scanResult) => {
          if (!scanResult) return;

          const now = Date.now();
          if (now < cooldownUntilRef.current) return;

          const text = scanResult.getText();
          if (!text || text === lastScanRef.current) return;

          cooldownUntilRef.current = now + 2000;
          lastScanRef.current = text;
          setLastRaw(text);

          const pass = parsePassUrl(text);

          if (!pass) {
            setParsed(null);
            setResult(null);
            setScanState("error");
            setMessage("Invalid QR. This is not a JRide Event Pass.");
            navigator.vibrate?.(300);
            beep(220, 250);
            return;
          }

          submitCheckIn(pass);
        }
      );

      controlsRef.current = controls;
      setScanState("scanning");
      setMessage("Scanner ready. Point camera at Event Pass QR.");
    } catch (error) {
      setScanState("error");
      setMessage(error instanceof Error ? error.message : "Camera failed to start.");
    }
  }

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanState("idle");
    setMessage("Scanner stopped.");
  }

  function resetScan() {
    lastScanRef.current = "";
    cooldownUntilRef.current = 0;
    checkingInRef.current = false;
    setLastRaw("");
    setParsed(null);
    setResult(null);
    setScanState(controlsRef.current ? "scanning" : "idle");
    setMessage(
      controlsRef.current
        ? "Scanner ready. Point camera at Event Pass QR."
        : "Press Start Scanner to begin."
    );
  }

  React.useEffect(() => {
    return () => {
      controlsRef.current?.stop();
    };
  }, []);

  const panelClass =
    scanState === "success"
      ? "border-emerald-400 bg-emerald-950"
      : scanState === "warning"
      ? "border-amber-400 bg-amber-950"
      : scanState === "error"
      ? "border-red-400 bg-red-950"
      : "border-slate-700 bg-slate-900";

  const statusTitle =
    result?.reason === "checked_in"
      ? "CHECKED IN"
      : result?.reason === "already_checked_in"
      ? "ALREADY CHECKED IN"
      : result?.reason === "pending_review"
      ? "HELP DESK REVIEW"
      : result?.reason === "invalid_token"
      ? "INVALID PASS"
      : "SCANNER STATUS";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <section className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            JRide Events Scanner
          </p>
          <h1 className="mt-3 text-3xl font-black">Gate Scanner</h1>
          <p className="mt-2 text-slate-300">Scan Event Pass QR codes for {eventSlug}.</p>

          <div className="mt-5 overflow-hidden rounded-3xl border border-slate-700 bg-black">
            <video
              ref={videoRef}
              className="aspect-[3/4] w-full object-cover md:aspect-video"
              muted
              playsInline
            />
          </div>

          <div className={`mt-5 rounded-3xl border p-5 ${panelClass}`}>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-slate-300">
              {statusTitle}
            </p>
            <p className="mt-3 text-3xl font-black">{message}</p>

            {result?.fullName ? (
              <div className="mt-5 rounded-2xl bg-white p-5 text-slate-950">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  Attendee
                </p>
                <p className="mt-2 text-3xl font-black">{result.fullName}</p>
                <p className="mt-2 text-lg font-bold text-slate-700">
                  {result.groupLabel || "Group"} {result.groupValue || ""}
                </p>
                <p className="mt-3 font-mono text-xl font-black">
                  {result.registrationNumber}
                </p>

                {result.checkedInAt ? (
                  <p className="mt-3 text-sm font-semibold text-slate-500">
                    Checked in: {formatCheckedIn(result.checkedInAt)}
                  </p>
                ) : null}

                {result.guests && result.guests.length > 0 ? (
                  <div className="mt-5 rounded-2xl bg-slate-100 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      Guests & Family
                    </p>
                    <div className="mt-3 space-y-2">
                      {result.guests.map((guest) => (
                        <div key={guest.attendeeId}>
                          <p className="font-bold">{guest.fullName}</p>
                          <p className="text-sm text-slate-500">
                            {guest.relationship} - {guest.registrationNumber}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : parsed ? (
              <div className="mt-5 rounded-2xl bg-white p-5 text-slate-950">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  Pass Detected
                </p>
                <p className="mt-2 font-mono text-2xl font-black">
                  {parsed.registrationNumber}
                </p>
              </div>
            ) : null}

            {lastRaw && !parsed ? (
              <p className="mt-4 break-all rounded-2xl bg-slate-950 p-4 text-xs text-slate-300">
                {lastRaw}
              </p>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={startScanner}
              disabled={scanState === "starting" || scanState === "scanning"}
              className="rounded-2xl bg-amber-400 px-5 py-4 font-black text-slate-950 disabled:opacity-50"
            >
              Start Scanner
            </button>
            <button
              type="button"
              onClick={resetScan}
              className="rounded-2xl border border-slate-600 px-5 py-4 font-black text-white"
            >
              Scan Next
            </button>
            <button
              type="button"
              onClick={stopScanner}
              className="rounded-2xl border border-red-400 px-5 py-4 font-black text-red-200"
            >
              Stop
            </button>
          </div>

          <div className="mt-5 rounded-2xl bg-slate-950 p-4 text-sm text-slate-400">
            EVT-006C connected scanner. Uses a 2-second scan cooldown to prevent duplicate API calls.
          </div>
        </div>
      </section>
    </main>
  );
}
