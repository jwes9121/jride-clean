"use client";

import * as React from "react";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import { useParams } from "next/navigation";

type ScanState =
  | "idle"
  | "scanning"
  | "result"
  | "manual_review";

type ResultTone =
  | "success"
  | "warning"
  | "error";

type ClaimPayload = {
  claimToken: string;
};

type ClaimResponse = {
  success: boolean;
  reason:
    | "claimed"
    | "already_claimed"
    | "invalid_request"
    | "invalid_token"
    | "program_not_found"
    | "program_mismatch"
    | "beneficiary_not_found"
    | "program_not_active"
    | "program_not_started"
    | "program_ended"
    | "beneficiary_not_active"
    | "entitlement_cancelled"
    | "staff_auth_required"
    | "claim_failed"
    | "server_error";
  duplicate?: boolean;
  claim?: {
    id: string;
    claimedAt: string;
    method: string;
    counterName: string | null;
    claimedByEmail: string;
  };
  event?: {
    id: string;
    slug: string;
    name: string;
  };
  program?: {
    id: string;
    key: string;
    name: string;
    beneficiaryLabel: string;
    itemLabel: string;
    claimLabel: string;
    status: string;
  };
  beneficiary?: {
    id: string;
    type: string;
    code: string;
    displayName: string;
    householdHeadName: string | null;
    mobileNumber: string | null;
    municipality: string | null;
    barangay: string | null;
    addressText: string | null;
    memberCount: number | null;
    status: string;
  };
  entitlement?: {
    id: string;
    itemKey: string;
    itemName: string;
    quantity: string | number;
    unitLabel: string;
    status: string;
  };
  message?: string;
  error?: string;
};

function parseClaimToken(raw: string): ClaimPayload | null {
  const text = String(raw || "").trim();

  if (!text) {
    return null;
  }

  try {
    const url = new URL(
      text.startsWith("/")
        ? `${window.location.origin}${text}`
        : text
    );

    const token =
      url.searchParams.get("claimToken") ||
      url.searchParams.get("token") ||
      "";

    if (token) {
      return {
        claimToken: token.trim(),
      };
    }
  } catch {}

  if (/^[a-f0-9]{32,128}$/i.test(text)) {
    return {
      claimToken: text,
    };
  }

  return null;
}

function beep(
  frequency = 880,
  durationMs = 120
) {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    const context =
      new AudioContextClass();

    const oscillator =
      context.createOscillator();

    const gain =
      context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value =
      frequency;
    gain.gain.value = 0.08;

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start();

    window.setTimeout(() => {
      oscillator.stop();
      void context.close();
    }, durationMs);
  } catch {}
}

function successDing() {
  beep(1046, 90);
  window.setTimeout(
    () => beep(1318, 140),
    100
  );
}

function formatClaimTime(
  value: string | null | undefined
) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "en-PH",
    {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }
  ).format(new Date(value));
}

function formatQuantity(
  value: string | number | undefined,
  unitLabel: string | undefined
) {
  const numericValue =
    value === undefined
      ? Number.NaN
      : Number(value);

  const quantityText =
    Number.isFinite(numericValue)
      ? new Intl.NumberFormat(
          "en-PH",
          {
            maximumFractionDigits: 3,
          }
        ).format(numericValue)
      : String(value || "");

  return `${quantityText} ${unitLabel || ""}`.trim();
}

export default function HongaClaimScannerPage() {
  const params = useParams<{
    eventSlug: string;
  }>();

  const eventSlug = String(
    params?.eventSlug || ""
  );

  const videoRef =
    React.useRef<HTMLVideoElement | null>(
      null
    );

  const controlsRef =
    React.useRef<IScannerControls | null>(
      null
    );

  const lastScanRef =
    React.useRef("");

  const cooldownUntilRef =
    React.useRef(0);

  const claimInFlightRef =
    React.useRef(false);

  const scannerActiveRef =
    React.useRef(false);

  const autoResumeTimerRef =
    React.useRef<number | null>(null);

  const sessionIdRef =
    React.useRef(0);

  const [scanState, setScanState] =
    React.useState<ScanState>("idle");

  const [resultTone, setResultTone] =
    React.useState<ResultTone>("success");

  const [message, setMessage] =
    React.useState(
      "Press Start Scanner to begin."
    );

  const [lastRaw, setLastRaw] =
    React.useState("");

  const [parsed, setParsed] =
    React.useState<ClaimPayload | null>(
      null
    );

  const [result, setResult] =
    React.useState<ClaimResponse | null>(
      null
    );

  const [counterName, setCounterName] =
    React.useState("Pahing Counter 1");

  const [manualToken, setManualToken] =
    React.useState("");

  function invalidateActiveSession() {
    sessionIdRef.current += 1;
  }

  function clearAutoResumeTimer() {
    if (
      autoResumeTimerRef.current !== null
    ) {
      window.clearTimeout(
        autoResumeTimerRef.current
      );

      autoResumeTimerRef.current = null;
    }
  }

  function stopReaderOnly() {
    scannerActiveRef.current = false;

    controlsRef.current?.stop();
    controlsRef.current = null;
  }

  function scheduleAutoResume() {
    clearAutoResumeTimer();

    autoResumeTimerRef.current =
      window.setTimeout(() => {
        restartScanner();
      }, 2000);
  }

  function showResult(
    tone: ResultTone,
    nextMessage: string,
    autoResume: boolean
  ) {
    stopReaderOnly();

    setResultTone(tone);
    setScanState("result");
    setMessage(nextMessage);

    if (autoResume) {
      scheduleAutoResume();
    }
  }

  function showManualReview(
    nextMessage: string
  ) {
    clearAutoResumeTimer();
    stopReaderOnly();

    setResultTone("warning");
    setScanState("manual_review");
    setMessage(nextMessage);
  }

  async function submitClaim(
    payload: ClaimPayload,
    requestSessionId: number
  ) {
    if (claimInFlightRef.current) {
      return;
    }

    claimInFlightRef.current = true;

    setParsed(payload);
    setResult(null);
    setMessage("Verifying claim stub...");

    try {
      const response = await fetch(
        `/api/events/${eventSlug}/distribution/claim`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            claimToken:
              payload.claimToken,
            claimMethod: "qr",
            counterName:
              counterName.trim() ||
              "Pahing Counter",
          }),
        }
      );

      let data: ClaimResponse;

      try {
        data =
          (await response.json()) as ClaimResponse;
      } catch {
        data = {
          success: false,
          reason:
            response.status === 401
              ? "staff_auth_required"
              : "server_error",
          message:
            "Claim response was invalid.",
        };
      }

      if (
        requestSessionId !==
        sessionIdRef.current
      ) {
        return;
      }

      setResult(data);

      if (
        response.status === 401 ||
        data.reason ===
          "staff_auth_required"
      ) {
        navigator.vibrate?.([
          150,
          100,
          150,
        ]);

        beep(440, 220);

        showManualReview(
          data.message ||
            data.error ||
            "Authorized staff session is required."
        );

        return;
      }

      if (
        data.success &&
        data.reason === "claimed"
      ) {
        navigator.vibrate?.(120);
        successDing();

        showResult(
          "success",
          "Pahing released successfully.",
          true
        );

        return;
      }

      if (
        data.success &&
        data.reason ===
          "already_claimed"
      ) {
        navigator.vibrate?.([
          100,
          80,
          100,
        ]);

        beep(520, 180);

        showResult(
          "warning",
          "Pahing was already claimed.",
          true
        );

        return;
      }

      if (
        [
          "program_not_active",
          "program_not_started",
          "program_ended",
          "beneficiary_not_active",
          "entitlement_cancelled",
          "program_mismatch",
        ].includes(data.reason)
      ) {
        navigator.vibrate?.([
          150,
          100,
          150,
        ]);

        beep(440, 220);

        showManualReview(
          data.message ||
            "Manual review is required."
        );

        return;
      }

      navigator.vibrate?.(300);
      beep(220, 250);

      showResult(
        "error",
        data.message ||
          data.error ||
          "Invalid claim stub.",
        true
      );
    } catch (error) {
      if (
        requestSessionId !==
        sessionIdRef.current
      ) {
        return;
      }

      navigator.vibrate?.(300);
      beep(220, 250);

      showResult(
        "error",
        error instanceof Error
          ? error.message
          : "Claim failed.",
        true
      );
    } finally {
      if (
        requestSessionId ===
        sessionIdRef.current
      ) {
        claimInFlightRef.current = false;
      }
    }
  }

  async function startScanner() {
    clearAutoResumeTimer();

    if (!videoRef.current) {
      setMessage(
        "Camera is not ready. Try Restart Camera."
      );

      setScanState("idle");
      return;
    }

    stopReaderOnly();
    invalidateActiveSession();

    const mySession =
      sessionIdRef.current;

    lastScanRef.current = "";
    cooldownUntilRef.current =
      Date.now() + 500;

    claimInFlightRef.current = false;
    scannerActiveRef.current = true;

    setLastRaw("");
    setParsed(null);
    setResult(null);
    setScanState("scanning");
    setMessage("Starting camera...");

    try {
      const reader =
        new BrowserMultiFormatReader();

      const controls =
        await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (scanResult) => {
            if (!scanResult) {
              return;
            }

            if (
              !scannerActiveRef.current
            ) {
              return;
            }

            if (
              mySession !==
              sessionIdRef.current
            ) {
              return;
            }

            const now = Date.now();

            if (
              now <
              cooldownUntilRef.current
            ) {
              return;
            }

            const text =
              scanResult.getText();

            if (
              !text ||
              text === lastScanRef.current
            ) {
              return;
            }

            cooldownUntilRef.current =
              now + 2000;

            lastScanRef.current = text;

            setLastRaw(text);

            const payload =
              parseClaimToken(text);

            if (!payload) {
              setParsed(null);
              setResult(null);

              navigator.vibrate?.(300);
              beep(220, 250);

              showResult(
                "error",
                "Invalid QR. This is not a JRide Honga claim stub.",
                true
              );

              return;
            }

            void submitClaim(
              payload,
              mySession
            );
          }
        );

      if (
        mySession !==
        sessionIdRef.current
      ) {
        controls.stop();
        return;
      }

      controlsRef.current = controls;

      setScanState("scanning");

      setMessage(
        "Scanner ready. Point camera at the Honga claim stub."
      );
    } catch (error) {
      setResult(null);
      setResultTone("error");
      setScanState("result");

      setMessage(
        error instanceof Error
          ? error.message
          : "Camera failed to start."
      );
    }
  }

  function restartScanner() {
    clearAutoResumeTimer();
    stopReaderOnly();
    invalidateActiveSession();

    const restartSessionId =
      sessionIdRef.current;

    lastScanRef.current = "";

    cooldownUntilRef.current =
      Date.now() + 500;

    claimInFlightRef.current = false;
    scannerActiveRef.current = true;

    setLastRaw("");
    setParsed(null);
    setResult(null);
    setScanState("idle");

    setMessage(
      "Restarting scanner..."
    );

    autoResumeTimerRef.current =
      window.setTimeout(() => {
        autoResumeTimerRef.current = null;

        if (
          restartSessionId !==
          sessionIdRef.current
        ) {
          return;
        }

        void startScanner();
      }, 150);
  }

  function stopScanner() {
    clearAutoResumeTimer();
    stopReaderOnly();
    invalidateActiveSession();

    claimInFlightRef.current = false;

    setScanState("idle");
    setMessage("Scanner stopped.");
  }

  function submitManualClaim() {
    const payload =
      parseClaimToken(
        manualToken.trim()
      );

    if (!payload) {
      setResult(null);
      setParsed(null);

      showResult(
        "error",
        "Enter a valid Honga claim token.",
        false
      );

      return;
    }

    stopReaderOnly();
    invalidateActiveSession();

    const manualSession =
      sessionIdRef.current;

    setLastRaw(manualToken.trim());

    void submitClaim(
      payload,
      manualSession
    );
  }

  React.useEffect(() => {
    return () => {
      clearAutoResumeTimer();
      stopReaderOnly();
      invalidateActiveSession();
    };
  }, []);

  const showOverlay =
    scanState === "result" ||
    scanState === "manual_review";

  const overlayClass =
    resultTone === "success"
      ? "border-emerald-300 bg-emerald-950"
      : resultTone === "warning"
      ? "border-amber-300 bg-amber-950"
      : "border-red-300 bg-red-950";

  const overlayTitle =
    result?.reason === "claimed"
      ? "PAHING RELEASED"
      : result?.reason ===
        "already_claimed"
      ? "ALREADY CLAIMED"
      : scanState ===
        "manual_review"
      ? "MANUAL REVIEW"
      : resultTone === "error"
      ? "INVALID CLAIM"
      : "CLAIM RESULT";

  const overlayHint =
    scanState === "manual_review"
      ? "Manual action required. Resolve the issue, then tap Restart Camera."
      : "Scanner will resume automatically.";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <section className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
                JRide Events
              </p>

              <h1 className="mt-3 text-3xl font-black">
                Honga Pahing Release Counter
              </h1>

              <p className="mt-2 text-slate-300">
                Scan household claim stubs for{" "}
                {eventSlug}.
              </p>
            </div>

            <div className="w-full md:max-w-xs">
              <label className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
                Counter Name
              </label>

              <input
                value={counterName}
                onChange={(event) =>
                  setCounterName(
                    event.target.value
                  )
                }
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold text-white outline-none focus:border-amber-300"
              />
            </div>
          </div>

          {showOverlay ? (
            <div
              className={`mt-5 rounded-3xl border p-7 text-center ${overlayClass}`}
            >
              <p className="text-sm font-black uppercase tracking-[0.35em] text-white/70">
                {overlayTitle}
              </p>

              <p className="mt-5 text-4xl font-black leading-tight md:text-5xl">
                {message}
              </p>

              {result?.beneficiary ? (
                <div className="mt-7 rounded-3xl bg-white p-6 text-slate-950">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Household
                  </p>

                  <p className="mt-2 text-3xl font-black">
                    {
                      result.beneficiary
                        .displayName
                    }
                  </p>

                  <p className="mt-3 font-mono text-xl font-black">
                    {
                      result.beneficiary
                        .code
                    }
                  </p>

                  {result.beneficiary
                    .householdHeadName ? (
                    <p className="mt-4 text-lg font-bold text-slate-700">
                      Head:{" "}
                      {
                        result.beneficiary
                          .householdHeadName
                      }
                    </p>
                  ) : null}

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-100 p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                        Location
                      </p>

                      <p className="mt-2 font-bold">
                        {[
                          result.beneficiary
                            .barangay,
                          result.beneficiary
                            .municipality,
                        ]
                          .filter(Boolean)
                          .join(", ") ||
                          "-"}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-100 p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                        Members
                      </p>

                      <p className="mt-2 text-2xl font-black">
                        {result.beneficiary
                          .memberCount ??
                          "-"}
                      </p>
                    </div>
                  </div>

                  {result.entitlement ? (
                    <div className="mt-5 rounded-2xl bg-amber-100 p-5 text-amber-950">
                      <p className="text-xs font-black uppercase tracking-[0.15em]">
                        Release
                      </p>

                      <p className="mt-2 text-3xl font-black">
                        {
                          result.entitlement
                            .itemName
                        }
                      </p>

                      <p className="mt-2 text-xl font-bold">
                        {formatQuantity(
                          result.entitlement
                            .quantity,
                          result.entitlement
                            .unitLabel
                        )}
                      </p>
                    </div>
                  ) : null}

                  {result.claim?.claimedAt ? (
                    <p className="mt-5 text-sm font-semibold text-slate-500">
                      Claimed:{" "}
                      {formatClaimTime(
                        result.claim
                          .claimedAt
                      )}
                    </p>
                  ) : null}
                </div>
              ) : parsed ? (
                <div className="mt-7 rounded-3xl bg-white p-6 text-slate-950">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    Claim Token Detected
                  </p>

                  <p className="mt-2 break-all font-mono text-lg font-black">
                    {parsed.claimToken}
                  </p>
                </div>
              ) : null}

              {lastRaw && !parsed ? (
                <p className="mt-6 break-all rounded-2xl bg-slate-950 p-4 text-xs text-slate-300">
                  {lastRaw}
                </p>
              ) : null}

              <p className="mt-6 text-sm font-semibold text-white/80">
                {overlayHint}
              </p>
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
            <div className="mt-5 rounded-3xl border border-slate-700 bg-slate-950 p-5">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-slate-300">
                RELEASE STATUS
              </p>

              <p className="mt-3 text-3xl font-black">
                {message}
              </p>
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() =>
                void startScanner()
              }
              disabled={
                scanState === "scanning"
              }
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

          <div className="mt-5 rounded-3xl border border-slate-700 bg-slate-950 p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Manual Search Token
            </p>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                value={manualToken}
                onChange={(event) =>
                  setManualToken(
                    event.target.value
                  )
                }
                placeholder="Paste claim token or claim URL"
                className="min-w-0 flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-4 font-mono text-white outline-none focus:border-amber-300"
              />

              <button
                type="button"
                onClick={submitManualClaim}
                className="rounded-2xl bg-white px-5 py-4 font-black text-slate-950"
              >
                Submit Claim
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-2xl bg-slate-950 p-4 text-sm text-slate-400">
            Authorized staff only. Successful claims are final and duplicate scans return the original claim record.
          </div>
        </div>
      </section>
    </main>
  );
}
