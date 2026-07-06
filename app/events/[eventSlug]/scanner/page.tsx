"use client";

import * as React from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { useParams } from "next/navigation";

type ScanState = "idle" | "scanning" | "result" | "pending_review";
type ResultTone = "success" | "warning" | "error";

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
    const text = String(raw || "").trim();
    const url = new URL(
      text.startsWith("/") ? `${window.location.origin}${text}` : text
    );
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
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

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

function successDing() {
  beep(1046, 90);
  window.setTimeout(() => beep(1318, 140), 100);
}

function formatCheckedIn(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    hour12: true,
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
  const autoResumeTimerRef = React.useRef<number | null>(null);

  const [scanState, setScanState] = React.useState<ScanState>("idle");
  const [resultTone, setResultTone] = React.useState<ResultTone>("success");
  const [message, setMessage] = React.useState("Press Start Scanner to begin.");
  const [lastRaw, setLastRaw] = React.useState("");
  const [parsed, setParsed] = React.useState<ParsedPass | null>(null);
  const [result, setResult] = React.useState<CheckInResponse | null>(null);

  function clearAutoResumeTimer() {
    if (autoResumeTimerRef.current !== null) {
      window.clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }
  }

  function stopReaderOnly() {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }

  function scheduleAutoResume() {
    clearAutoResumeTimer();
    autoResumeTimerRef.current = window.setTimeout(() => {
      restartScanner();
    }, 2000);
  }

  function showResult(tone: ResultTone, nextMessage: string, autoResume: boolean) {
    stopReaderOnly();
    setResultTone(tone);
    setScanState("result");
    setMessage(nextMessage);

    if (autoResume) {
      scheduleAutoResume();
    }
  }

  function showPendingReview(nextMessage: string) {
    clearAutoResumeTimer();
    stopReaderOnly();
    setResultTone("warning");
    setScanState("pending_review");
    setMessage(nextMessage);
  }

  async function submitCheckIn(pass: ParsedPass) {
    if (checkingInRef.current) return;

    checkingInRef.current = true;
    setParsed(pass);
    setResult(null);
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
        navigator.vibrate?.(120);
        successDing();
        showResult("success", "Checked in successfully.", true);
        return;
      }

      if (data.reason === "already_checked_in") {
        navigator.vibrate?.([100, 80, 100]);
        beep(520, 180);
        showResult("warning", "Already checked in.", true);
        return;
      }

      if (data.reason === "pending_review") {
        navigator.vibrate?.([150, 100, 150]);
        beep(440, 220);
        showPendingReview("Needs Help Desk review.");
        return;
      }

      navigator.vibrate?.(300);
      beep(220, 250);
      showResult("error", data.message || "Invalid Event Pass.", true);
    } catch (error) {
      navigator.vibrate?.(300);
      beep(220, 250);
      showResult(
        "error",
        error instanceof Error ? error.message : "Check-in failed.",
        true
      );
    } finally {
      checkingInRef.current = false;
    }
  }

  async function startScanner() {
    clearAutoResumeTimer();

    if (!videoRef.current) {
      setMessage("Camera is not ready. Try Restart Camera.");
      setScanState("idle");
      return;
    }

    stopReaderOnly();
    lastScanRef.current = "";
    cooldownUntilRef.current = Date.now() + 500;
    checkingInRef.current = false;
    setLastRaw("");
    setParsed(null);
    setResult(null);
    setScanState("scanning");
    setMessage("Starting camera...");

    try {
      const reader = new BrowserMultiFormatReader();

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (scanResult) => {
          if (!scanResult) return;
          if (scanState !== "scanning") return;

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
            navigator.vibrate?.(300);
            beep(220, 250);
            showResult("error", "Invalid QR. This is not a JRide Event Pass.", true);
            return;
          }

          submitCheckIn(pass);
        }
      );

      controlsRef.current = controls;
      setScanState("scanning");
      setMessage("Scanner ready. Point camera at Event Pass QR.");
    } catch (error) {
      setResult(null);
      setResultTone("error");
      setScanState("result");
      setMessage(error instanceof Error ? error.message : "Camera failed to start.");
    }
  }

  function restartScanner() {
    clearAutoResumeTimer();
    stopReaderOnly();
    lastScanRef.current = "";
    cooldownUntilRef.current = Date.now() + 500;
    checkingInRef.current = false;
    setLastRaw("");
    setParsed(null);
    setResult(null);
    setScanState("idle");
    setMessage("Restarting scanner...");
    window.setTimeout(() => {
      void startScanner();
    }, 150);
  }

  function stopScanner() {
    clearAutoResumeTimer();
    stopReaderOnly();
    checkingInRef.current = false;
    setScanState("idle");
    setMessage("Scanner stopped.");
  }

  React.useEffect(() => {
    return () => {
      clearAutoResumeTimer();
      stopReaderOnly();
    };
  }, []);

  const showOverlay = scanState === "result" || scanState === "pending_review";

  const overlayClass =
    resultTone === "success"
      ? "border-emerald-300 bg-emerald-950"
      : resultTone === "warning"
      ? "border-amber-300 bg-amber-950"
      : "border-red-300 bg-red-950";

  const overlayTitle =
    result?.reason === "checked_in"
      ? "CHECKED IN"
      : result?.reason === "already_checked_in"
      ? "ALREADY CHECKED IN"
      : result?.reason === "pending_review"
      ? "HELP DESK REVIEW"
      : resultTone === "error"
      ? "INVALID QR"
      : "SCANNER RESULT";

  const overlayHint =
    scanState === "pending_review"
      ? "Manual action required. Send attendee to Help Desk, then tap Restart Camera."
      : "Scanner will resume automatically.";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <section className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            JRide Events Scanner
          </p>
          <h1 className="mt-3 text-3xl font-black">Gate Scanner</h1>
          <p className="mt-2 text-slate-300">Scan Event Pass QR codes for {eventSlug}.</p>

          {showOverlay ? (
            <div className={`mt-5 rounded-3xl border p-7 text-center ${overlayClass}`}>
              <p className="text-sm font-black uppercase tracking-[0.35em] text-white/70">
                {overlayTitle}
              </p>
              <p className="mt-5 text-5xl font-black leading-tight">{message}</p>

              {result?.fullName ? (
                <div className="mt-7 rounded-3xl bg-white p-6 text-slate-950">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Attendee
                  </p>
                  <p className="mt-2 text-4xl font-black">{result.fullName}</p>
                  <p className="mt-3 text-xl font-bold text-slate-700">
                    {result.groupLabel || "Group"} {result.groupValue || ""}
                  </p>
                  <p className="mt-4 font-mono text-2xl font-black">
                    {result.registrationNumber}
                  </p>

                  {result.checkedInAt ? (
                    <p className="mt-4 text-base font-semibold text-slate-500">
                      Checked in: {formatCheckedIn(result.checkedInAt)}
                    </p>
                  ) : null}

                  {result.guests && result.guests.length > 0 ? (
                    <div className="mt-6 rounded-2xl bg-slate-100 p-4 text-left">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                        Guests & Family
                      </p>
                      <div className="mt-3 space-y-2">
                        {result.guests.map((guest) => (
                          <div key={guest.attendeeId} className="flex gap-3">
                            <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-700">
                              G
                            </span>
                            <div>
                              <p className="font-bold">{guest.fullName}</p>
                              <p className="text-sm text-slate-500">
                                {guest.relationship} - {guest.registrationNumber}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : parsed ? (
                <div className="mt-7 rounded-3xl bg-white p-6 text-slate-950">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Pass Detected
                  </p>
                  <p className="mt-2 font-mono text-3xl font-black">
                    {parsed.registrationNumber}
                  </p>
                </div>
              ) : null}

              {lastRaw && !parsed ? (
                <p className="mt-6 break-all rounded-2xl bg-slate-950 p-4 text-xs text-slate-300">
                  {lastRaw}
                </p>
              ) : null}

              <p className="mt-6 text-sm font-semibold text-white/80">{overlayHint}</p>
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-3xl border border-slate-700 bg-black">
              <video
                ref={videoRef}
                className="aspect-[3/4] w-full object-cover md:aspect-video"
                muted
                playsInline
              />
            </div>
          )}

          {!showOverlay ? (
            <div className="mt-5 rounded-3xl border border-slate-700 bg-slate-900 p-5">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-slate-300">
                SCANNER STATUS
              </p>
              <p className="mt-3 text-3xl font-black">{message}</p>
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => void startScanner()}
              disabled={scanState === "scanning"}
              className="rounded-2xl bg-amber-400 px-5 py-4 font-black text-slate-950 disabled:opacity-50"
            >
              Start Scanner
            </button>
            <button
              type="button"
              onClick={restartScanner}
              className="rounded-2xl border border-slate-600 px-5 py-4 font-black text-white"
            >
              Restart Camera
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
            EVT-006D field scanner. Shows full-screen results and resumes automatically except Help Desk review.
          </div>
        </div>
      </section>
    </main>
  );
}
