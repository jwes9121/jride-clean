"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type LifecycleGetResponse =
  | {
      success: true;
      eventSlug: string;
      currentStatus: string;
      validNextStatuses: string[];
      canTransition: boolean;
    }
  | {
      success: false;
      error: string;
    };

type LifecyclePostResponse =
  | {
      success: true;
      eventId: string;
      previousStatus: string;
      newStatus: string;
    }
  | {
      success: false;
      errorCode?: string;
      error: string;
      previousStatus?: string | null;
    };

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  registration_open: "Registration Open",
  registration_closed: "Registration Closed",
  live: "Live",
  completed: "Completed",
  archived: "Archived",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] || status;
}

export default function EventLifecyclePage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = params.eventSlug;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [validNextStatuses, setValidNextStatuses] = useState<string[]>([]);
  const [canTransition, setCanTransition] = useState(false);

  const [reason, setReason] = useState("");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const res = await fetch(`/api/events/${eventSlug}/lifecycle`, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await res.json()) as LifecycleGetResponse;

      if (!data.success) {
        setLoadError(data.error);
        setCurrentStatus(null);
        setValidNextStatuses([]);
        setCanTransition(false);
        return;
      }

      setCurrentStatus(data.currentStatus);
      setValidNextStatuses(data.validNextStatuses);
      setCanTransition(data.canTransition);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Failed to load event."
      );
    } finally {
      setLoading(false);
    }
  }, [eventSlug]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleTransition(toStatus: string) {
    setPendingStatus(toStatus);
    setActionError(null);
    setLastSuccess(null);

    try {
      const res = await fetch(`/api/events/${eventSlug}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus,
          reason: reason.trim() || undefined,
        }),
      });
      const data = (await res.json()) as LifecyclePostResponse;

      if (!data.success) {
        setActionError(data.error);
        return;
      }

      setLastSuccess(
        `Moved from ${statusLabel(data.previousStatus)} to ${statusLabel(
          data.newStatus
        )}.`
      );
      setReason("");
      await loadStatus();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Transition failed."
      );
    } finally {
      setPendingStatus(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <section className="mx-auto max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
          Event Lifecycle
        </p>
        <h1 className="mt-2 text-3xl font-bold">{eventSlug}</h1>

        {loading && (
          <p className="mt-6 text-slate-400">Loading current status...</p>
        )}

        {!loading && loadError && (
          <div className="mt-6 rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-200">
            {loadError}
          </div>
        )}

        {!loading && !loadError && currentStatus && (
          <>
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                Current Status
              </p>
              <p className="mt-2 text-2xl font-bold">
                {statusLabel(currentStatus)}
              </p>
            </div>

            {!canTransition && (
              <p className="mt-4 text-sm text-amber-300">
                Your account can view this event's lifecycle but cannot
                change it. Lifecycle transitions require an admin role.
              </p>
            )}

            <div className="mt-6">
              <label className="text-sm uppercase tracking-[0.2em] text-slate-400">
                Reason (optional, recorded in the audit log)
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={!canTransition}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white disabled:opacity-50"
                placeholder="e.g. closing registration early, venue confirmed"
              />
            </div>

            <div className="mt-6">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                Available Transitions
              </p>

              {validNextStatuses.length === 0 && (
                <p className="mt-3 text-slate-400">
                  No further transitions are available from this status.
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-3">
                {validNextStatuses.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={!canTransition || pendingStatus !== null}
                    onClick={() => handleTransition(status)}
                    className="rounded-xl border border-amber-400 bg-amber-400 px-5 py-3 font-semibold text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {pendingStatus === status
                      ? "Applying..."
                      : `Move to ${statusLabel(status)}`}
                  </button>
                ))}
              </div>
            </div>

            {actionError && (
              <div className="mt-6 rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-200">
                {actionError}
              </div>
            )}

            {lastSuccess && (
              <div className="mt-6 rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-emerald-200">
                {lastSuccess}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
