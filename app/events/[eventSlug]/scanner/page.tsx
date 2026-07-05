"use client";

import * as React from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
import { useParams } from "next/navigation";

type ScanState = "idle" | "starting" | "scanning" | "success" | "error";

function parsePassUrl(raw: string): { registrationNumber: string; qrToken: string } | null {
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

function beep() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      context.close();
    }, 120);
  } catch {}
}

export default function EventScannerPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const lastScanRef = React.useRef("");

  const [scanState, setScanState] = React.useState<ScanState>("idle");
  const [message, setMessage] = React.useState("Press Start Scanner to begin.");
  const [lastRaw, setLastRaw] = React.useState("");
  const [parsed, setParsed] = React.useState<{
    registrationNumber: string;
    qrToken: string;
  } | null>(null);

  async function startScanner() {
    if (!videoRef.current) return;

    setScanState("starting");
    setMessage("Starting camera...");

    try {
      const reader = new BrowserMultiFormatReader();

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          if (!result) return;

          const text = result.getText();
          if (!text || text === lastScanRef.current) return;

          lastScanRef.current = text;
          setLastRaw(text);

          const pass = parsePassUrl(text);

          if (!pass) {
            setParsed(null);
            setScanState("error");
            setMessage("Invalid QR. This is not a JRide Event Pass.");
            navigator.vibrate?.(300);
            return;
          }

          setParsed(pass);
          setScanState("success");
          setMessage("Event Pass detected.");
          navigator.vibrate?.(120);
          beep();
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
    setLastRaw("");
    setParsed(null);
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
      : scanState === "error"
      ? "border-red-400 bg-red-950"
      : "border-slate-700 bg-slate-900";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <section className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            JRide Events Scanner
          </p>
          <h1 className="mt-3 text-3xl font-black">Gate Scanner</h1>
          <p className="mt-2 text-slate-300">
            Scan Event Pass QR codes for {eventSlug}.
          </p>

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
              Scanner Status
            </p>
            <p className="mt-3 text-2xl font-black">{message}</p>

            {parsed ? (
              <div className="mt-5 rounded-2xl bg-white p-5 text-slate-950">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  Pass Detected
                </p>
                <p className="mt-2 font-mono text-2xl font-black">
                  {parsed.registrationNumber}
                </p>
                <p className="mt-2 break-all text-xs text-slate-500">
                  Token: {parsed.qrToken}
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
            EVT-006A scanner shell only. Check-in API will be connected in EVT-006B.
          </div>
        </div>
      </section>
    </main>
  );
}
