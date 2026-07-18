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

type CheckpointScanResponse = {
  success: boolean;
  reason:
    | "checkpoint_recorded"
    | "already_recorded"
    | "invalid_token"
    | "attendee_not_eligible"
    | "checkpoint_not_found"
    | "invalid_request"
    | "station_auth_required"
    | "server_error";
  duplicate?: boolean;
  passageId?: string;
  passedAt?: string;
  checkpoint?: {
    id: string;
    name: string;
    number: number | null;
    sortOrder: number;
  };
  station?: {
    id: string;
    name: string;
  };
  attendee?: {
    id: string;
    fullName: string;
    registrationNumber: string;
  };
  attendeeId?: string;
  fullName?: string;
  registrationNumber?: string;
  message?: string;
};

const STATION_TOKEN_PREFIX = "jrst_";

function stationTokenStorageKey(eventSlug: string) {
  return `jride_event_checkpoint_scanner_token_${eventSlug}`;
}

function isValidStationTokenShape(value: string) {
  return value.startsWith(STATION_TOKEN_PREFIX) && value.length > STATION_TOKEN_PREFIX.length;
}

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

function formatPassedAt(value: string | null | undefined) {
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

export default function EventCheckpointScannerPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const lastScanRef = React.useRef("");
  const cooldownUntilRef = React.useRef(0);
  const checkingInRef = React.useRef(false);
  const scannerActiveRef = React.useRef(false);
  const autoResumeTimerRef = React.useRef<number | null>(null);

  // Station token is held in a ref, not just state, because the ZXing decode
  // callback closes over whatever was in scope when decodeFromVideoDevice was
  // called. Clearing React state alone does not invalidate that closure -
  // submitCheckpointScan() must read stationTokenRef.current at call time so a
  // revoked/reset token can never ride along on an in-flight callback.
  const stationTokenRef = React.useRef<string>("");

  // Bumped on every start, reset, revoke, stop, and unmount. A decode
  // callback captures the session id at the moment it is registered; if the
  // session id no longer matches when the callback fires (or when its
  // checkpoint request resolves), the result is discarded as stale. This
  // guards the case a token-only check would miss: user resets, sets up a
  // *new valid* token, but a decode event from the old camera session is
  // still in flight.
  const sessionIdRef = React.useRef(0);

  const [scanState, setScanState] = React.useState<ScanState>("idle");
  const [resultTone, setResultTone] = React.useState<ResultTone>("success");
  const [message, setMessage] = React.useState("Press Start Scanner to begin.");
  const [lastRaw, setLastRaw] = React.useState("");
  const [parsed, setParsed] = React.useState<ParsedPass | null>(null);
  const [result, setResult] = React.useState<CheckpointScanResponse | null>(null);

  const [stationToken, setStationTokenState] = React.useState<string>("");
  const [stationTokenLoaded, setStationTokenLoaded] = React.useState(false);
  const [stationSetupInput, setStationSetupInput] = React.useState("");
  const [stationSetupError, setStationSetupError] = React.useState("");

  // Loads the stored station token (if any) for the current eventSlug.
  // Scanning and checkpoint requests must not fire before this completes.
  // Runs on mount and whenever eventSlug changes (the component instance
  // can persist across a client-side route transition between two event
  // slugs without a full unmount) - so any session/token state tied to the
  // previous event is stopped and cleared first, never carried over.
  React.useEffect(() => {
    clearAutoResumeTimer();
    stopReaderOnly();
    invalidateActiveSession();
    checkingInRef.current = false;
    lastScanRef.current = "";
    stationTokenRef.current = "";
    setStationTokenState("");
    setScanState("idle");
    setResult(null);
    setParsed(null);
    setLastRaw("");
    setStationSetupInput("");
    setStationSetupError("");
    setStationTokenLoaded(false);

    if (!eventSlug) return;

    let stored = "";
    try {
      stored = window.localStorage.getItem(stationTokenStorageKey(eventSlug)) || "";
    } catch {
      stored = "";
    }

    if (stored && isValidStationTokenShape(stored)) {
      stationTokenRef.current = stored;
      setStationTokenState(stored);
    }

    setStationTokenLoaded(true);
  }, [eventSlug]);

  function invalidateActiveSession() {
    sessionIdRef.current += 1;
  }

  function clearAutoResumeTimer() {
    if (autoResumeTimerRef.current !== null) {
      window.clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }
  }

  function stopReaderOnly() {
    scannerActiveRef.current = false;
    controlsRef.current?.stop();
    controlsRef.current = null;
  }

  function saveStationToken(token: string) {
    const trimmed = token.trim();

    if (!isValidStationTokenShape(trimmed)) {
      setStationSetupError('Station token must begin with "jrst_".');
      return;
    }

    try {
      window.localStorage.setItem(stationTokenStorageKey(eventSlug), trimmed);
    } catch {
      setStationSetupError("Could not save station token on this device.");
      return;
    }

    // Invalidate any session that might still be active before a
    // replacement token takes effect, so no stale callback tied to the
    // previous token's session can act under the new one.
    clearAutoResumeTimer();
    stopReaderOnly();
    invalidateActiveSession();
    checkingInRef.current = false;

    stationTokenRef.current = trimmed;
    setStationTokenState(trimmed);
    setStationSetupInput("");
    setStationSetupError("");
    setMessage("Press Start Scanner to begin.");
    setScanState("idle");
  }

  function clearStationToken() {
    try {
      window.localStorage.removeItem(stationTokenStorageKey(eventSlug));
    } catch {}

    stationTokenRef.current = "";
    setStationTokenState("");
  }

  function resetStation() {
    clearAutoResumeTimer();
    stopReaderOnly();
    invalidateActiveSession();
    checkingInRef.current = false;
    lastScanRef.current = "";
    clearStationToken();
    setLastRaw("");
    setParsed(null);
    setResult(null);
    setStationSetupInput("");
    setStationSetupError("");
    setScanState("idle");
    setMessage("Station reset. Enter a station token to continue.");
  }

  function handleStationAuthFailure(serverMessage?: string) {
    clearAutoResumeTimer();
    stopReaderOnly();
    invalidateActiveSession();
    checkingInRef.current = false;
    lastScanRef.current = "";
    clearStationToken();
    setLastRaw("");
    setParsed(null);
    setResult(null);
    setScanState("idle");

    // Clearing the token routes the operator to the setup screen, which
    // only renders stationSetupError - not message. Put the reason there
    // too so the operator actually sees why setup is required again.
    const authMessage = serverMessage || "Checkpoint station authorization expired or was revoked.";
    setMessage(authMessage);
    setStationSetupInput("");
    setStationSetupError(authMessage);
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

  async function submitCheckpointScan(pass: ParsedPass, requestSessionId: number) {
    if (checkingInRef.current) return;

    // Read the token fresh, at the moment of submission - not from a value
    // captured earlier in a closure. If it is missing, a reset/revocation
    // happened between scan and submit; do not send the request at all.
    const requestToken = stationTokenRef.current;
    if (!requestToken) {
      return;
    }

    checkingInRef.current = true;
    setParsed(pass);
    setResult(null);
    setMessage("Recording checkpoint passage...");

    try {
      const res = await fetch(`/api/events/${eventSlug}/checkpoint-scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Event-Station-Token": requestToken,
        },
        body: JSON.stringify(pass),
      });

      let data: CheckpointScanResponse;
      try {
        data = (await res.json()) as CheckpointScanResponse;
      } catch {
        data = {
          success: false,
          reason: res.status === 401 ? "station_auth_required" : "server_error",
        };
      }

      // Discard results from a session that is no longer active (reset,
      // revoke, stop, or a new station setup happened while this request
      // was in flight). Do not touch checkingInRef here - it may already be
      // owned by a newer session's in-flight request, and this stale call
      // has no business releasing a lock it doesn't hold.
      if (requestSessionId !== sessionIdRef.current) {
        return;
      }

      if (res.status === 401 || data.reason === "station_auth_required") {
        handleStationAuthFailure(data.message);
        return;
      }

      setResult(data);

      if (data.success && data.reason === "checkpoint_recorded") {
        navigator.vibrate?.(120);
        successDing();
        showResult("success", "Checkpoint recorded successfully.", true);
        return;
      }

      if (data.reason === "already_recorded") {
        navigator.vibrate?.([100, 80, 100]);
        beep(520, 180);
        showResult("warning", "Checkpoint already recorded.", true);
        return;
      }

      if (data.reason === "attendee_not_eligible") {
        navigator.vibrate?.([150, 100, 150]);
        beep(440, 220);
        showPendingReview("Participant is not eligible at this checkpoint.");
        return;
      }

      navigator.vibrate?.(300);
      beep(220, 250);
      showResult("error", data.message || "Invalid Event Pass.", true);
    } catch (error) {
      if (requestSessionId !== sessionIdRef.current) {
        return;
      }

      navigator.vibrate?.(300);
      beep(220, 250);
      showResult(
        "error",
        error instanceof Error ? error.message : "Checkpoint scan failed.",
        true
      );
    } finally {
      // Only release the shared in-flight lock if this request still
      // belongs to the current session. An old, stale request finishing
      // must never clear a lock that a newer session's request now owns.
      if (requestSessionId === sessionIdRef.current) {
        checkingInRef.current = false;
      }
    }
  }

  async function startScanner() {
    clearAutoResumeTimer();

    // Hard requirement: startScanner() itself must refuse to initialize the
    // camera when no valid station token is loaded. Disabling the button is
    // not sufficient on its own.
    if (!stationTokenRef.current) {
      setMessage("Enter a checkpoint station token before starting the scanner.");
      setScanState("idle");
      return;
    }

    if (!videoRef.current) {
      setMessage("Camera is not ready. Try Restart Camera.");
      setScanState("idle");
      return;
    }

    stopReaderOnly();
    invalidateActiveSession();
    const mySession = sessionIdRef.current;

    lastScanRef.current = "";
    cooldownUntilRef.current = Date.now() + 500;
    checkingInRef.current = false;
    scannerActiveRef.current = true;
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
          if (!scannerActiveRef.current) return;

          // Reject decode events from a camera session that is no longer
          // the active one (old callback still registered after reset).
          if (mySession !== sessionIdRef.current) return;

          if (!stationTokenRef.current) return;

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

          submitCheckpointScan(pass, mySession);
        }
      );

      // The token or session may have been cleared while the camera was
      // still initializing (e.g. Reset Station tapped mid-startup).
      if (mySession !== sessionIdRef.current || !stationTokenRef.current) {
        controls.stop();
        return;
      }

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
    invalidateActiveSession();
    const restartSessionId = sessionIdRef.current;
    lastScanRef.current = "";
    cooldownUntilRef.current = Date.now() + 500;
    checkingInRef.current = false;
    scannerActiveRef.current = true;
    setLastRaw("");
    setParsed(null);
    setResult(null);
    setScanState("idle");
    setMessage("Restarting scanner...");

    // Tracked in autoResumeTimerRef (not a bare setTimeout) so Reset
    // Station, station-auth failure, Stop, and unmount can all cancel it
    // via clearAutoResumeTimer(). The session/token check just before
    // calling startScanner() prevents the camera from being reinitialized
    // if the operator reset the station during this 150ms window.
    autoResumeTimerRef.current = window.setTimeout(() => {
      autoResumeTimerRef.current = null;

      if (restartSessionId !== sessionIdRef.current) return;
      if (!stationTokenRef.current) return;

      void startScanner();
    }, 150);
  }

  function stopScanner() {
    clearAutoResumeTimer();
    stopReaderOnly();
    invalidateActiveSession();
    checkingInRef.current = false;
    setScanState("idle");
    setMessage("Scanner stopped.");
  }

  React.useEffect(() => {
    return () => {
      clearAutoResumeTimer();
      stopReaderOnly();
      invalidateActiveSession();
    };
  }, []);

  const needsStationSetup = stationTokenLoaded && !stationToken;

  const showOverlay = scanState === "result" || scanState === "pending_review";

  const overlayClass =
    resultTone === "success"
      ? "border-emerald-300 bg-emerald-950"
      : resultTone === "warning"
      ? "border-amber-300 bg-amber-950"
      : "border-red-300 bg-red-950";

  const overlayTitle =
    result?.reason === "checkpoint_recorded"
      ? "CHECKPOINT RECORDED"
      : result?.reason === "already_recorded"
      ? "ALREADY RECORDED"
      : result?.reason === "attendee_not_eligible"
      ? "NOT ELIGIBLE"
      : resultTone === "error"
      ? "INVALID QR"
      : "SCANNER RESULT";

  const overlayHint =
    scanState === "pending_review"
      ? "Manual action required. Verify the participant, then tap Restart Camera."
      : "Scanner will resume automatically.";

  if (!stationTokenLoaded) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
        <section className="mx-auto max-w-3xl">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
              JRide Events Checkpoint
            </p>
            <p className="mt-3 text-lg font-bold text-slate-300">Loading station...</p>
          </div>
        </section>
      </main>
    );
  }

  if (needsStationSetup) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
        <section className="mx-auto max-w-3xl">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
              JRide Events Checkpoint
            </p>
            <h1 className="mt-3 text-3xl font-black">Checkpoint Station Setup</h1>
            <p className="mt-2 text-slate-300">
              This device is not authorized for {eventSlug}. Enter the station token
              issued for this checkpoint. This is not an attendee QR token.
            </p>

            <form
              className="mt-6"
              onSubmit={(event) => {
                event.preventDefault();
                saveStationToken(stationSetupInput);
              }}
            >
              <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Station Token
              </label>
              <input
                type="password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={stationSetupInput}
                onChange={(event) => setStationSetupInput(event.target.value)}
                placeholder="jrst_..."
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 font-mono text-lg text-white outline-none focus:border-amber-300"
              />

              {stationSetupError ? (
                <p className="mt-3 text-sm font-bold text-red-300">{stationSetupError}</p>
              ) : null}

              <button
                type="submit"
                className="mt-5 w-full rounded-2xl bg-amber-400 px-5 py-4 font-black text-slate-950"
              >
                Save Station Token
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <section className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
                JRide Events Checkpoint
              </p>
              <h1 className="mt-3 text-3xl font-black">Checkpoint Scanner</h1>
              <p className="mt-2 text-slate-300">Record participant passage at this checkpoint for {eventSlug}.</p>
            </div>
            <button
              type="button"
              onClick={resetStation}
              className="shrink-0 rounded-2xl border border-slate-600 px-4 py-2 text-xs font-black uppercase tracking-[0.15em] text-slate-300"
            >
              Reset Station
            </button>
          </div>

          {showOverlay ? (
            <div className={`mt-5 rounded-3xl border p-7 text-center ${overlayClass}`}>
              <p className="text-sm font-black uppercase tracking-[0.35em] text-white/70">
                {overlayTitle}
              </p>
              <p className="mt-5 text-5xl font-black leading-tight">{message}</p>

              {result?.attendee || result?.fullName ? (
                <div className="mt-7 rounded-3xl bg-white p-6 text-slate-950">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Participant
                  </p>
                  <p className="mt-2 text-4xl font-black">
                    {result.attendee?.fullName || result.fullName}
                  </p>
                  <p className="mt-4 font-mono text-2xl font-black">
                    {result.attendee?.registrationNumber || result.registrationNumber}
                  </p>

                  {result.checkpoint ? (
                    <div className="mt-6 rounded-2xl bg-slate-100 p-4">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                        Checkpoint
                      </p>
                      <p className="mt-2 text-2xl font-black">
                        {result.checkpoint.name}
                      </p>
                      {result.station?.name ? (
                        <p className="mt-2 text-sm font-semibold text-slate-500">
                          Station: {result.station.name}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {result.passedAt ? (
                    <p className="mt-4 text-base font-semibold text-slate-500">
                      Passage time: {formatPassedAt(result.passedAt)}
                    </p>
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
              disabled={scanState === "scanning" || !stationToken}
              className="rounded-2xl bg-amber-400 px-5 py-4 font-black text-slate-950 disabled:opacity-50"
            >
              Start Scanner
            </button>
            <button
              type="button"
              onClick={restartScanner}
              disabled={!stationToken}
              className="rounded-2xl border border-slate-600 px-5 py-4 font-black text-white disabled:opacity-50"
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
            Checkpoint field scanner. Records passage only and does not modify event attendance.
          </div>
        </div>
      </section>
    </main>
  );
}
