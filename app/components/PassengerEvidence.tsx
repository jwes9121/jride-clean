"use client";

import * as React from "react";
import type { EvidenceKind } from "@/lib/passenger/identity";

export default function PassengerEvidence(props: {
  passengerId: string;
  canView: boolean;
  hasId: boolean;
  hasBack?: boolean;
  hasSelfie: boolean;
}) {
  const [preview, setPreview] = React.useState<{ url: string; label: string } | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const pending = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    setPreview(null);
    setError("");
    setBusy(false);
    return () => pending.current?.abort();
  }, [props.passengerId, props.canView]);

  React.useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => setPreview(null), 60000);
    return () => window.clearTimeout(timer);
  }, [preview]);

  async function open(kind: EvidenceKind, label: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const response = await fetch("/api/admin/passenger-verifications/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ passenger_id: props.passengerId, kind }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Evidence could not be opened.");
      if (!controller.signal.aborted) setPreview({ url: data.url, label });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Evidence could not be opened.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  if (!props.canView) return <p className="text-xs text-slate-600">Verification evidence is restricted to authorized admins.</p>;
  const options: { kind: EvidenceKind; label: string; available: boolean }[] = [
    { kind: "id_front", label: "ID front", available: props.hasId },
    { kind: "id_back", label: "ID back", available: !!props.hasBack },
    { kind: "selfie", label: "Selfie with ID", available: props.hasSelfie },
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-600">Evidence access is logged. Links expire after one minute.</p>
      <div className="flex flex-wrap gap-2">
        {options.filter((option) => option.available).map((option) => (
          <button key={option.kind} type="button" disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            onClick={() => open(option.kind, option.label)}>View {option.label}</button>
        ))}
      </div>
      {!options.some((option) => option.available) ? <p className="text-sm text-slate-600">No evidence file is recorded.</p> : null}
      {busy ? <p role="status" className="text-sm">Opening evidence...</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {preview ? (
        <div className="rounded-lg border border-slate-300 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <a href={preview.url} target="_blank" rel="noreferrer noopener" className="text-sm font-semibold underline">Open {preview.label}</a>
            <button type="button" onClick={() => setPreview(null)} className="text-sm underline">Close evidence</button>
          </div>
          {/* A short-lived private URL must never pass through an image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt={preview.label} referrerPolicy="no-referrer"
            className="max-h-[600px] max-w-full object-contain"
            onError={() => { setPreview(null); setError("The preview expired or is unavailable. Reopen the evidence to retry."); }} />
        </div>
      ) : null}
    </div>
  );
}
