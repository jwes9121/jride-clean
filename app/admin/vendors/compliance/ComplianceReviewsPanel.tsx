"use client";

import { clean, fmt } from "./shared";

type Props = {
  reviews: any[];
  showAllReviews: boolean;
  setShowAllReviews: (value: boolean) => void;
  canManage: boolean;
  busy: boolean;
  onApproveWarning: (review: any) => void | Promise<void>;
  onSuspend: (review: any) => void | Promise<void>;
  onDismiss: (review: any) => void | Promise<void>;
};

export default function ComplianceReviewsPanel({
  reviews,
  showAllReviews,
  setShowAllReviews,
  canManage,
  busy,
  onApproveWarning,
  onSuspend,
  onDismiss,
}: Props) {
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black">Pending compliance cases</h2>
          <p className="text-xs text-slate-500">
            Review the evidence before applying any sanction.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            checked={showAllReviews}
            onChange={(event) => setShowAllReviews(event.target.checked)}
          />
          Show reviewed cases
        </label>
      </div>

      <div className="mt-3 space-y-2">
        {reviews.length === 0 ? (
          <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-500">
            No compliance cases match this view.
          </div>
        ) : null}
        {reviews.map((review) => (
          <div key={review.id} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-black text-slate-950">
                  {review.vendor_name}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {review.town || "-"} | {review.review_type} | created{" "}
                  {fmt(review.created_at)}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-800">
                  {review.reason}
                </div>
                <pre className="mt-2 max-w-3xl overflow-auto rounded-lg bg-slate-950 p-2 text-[10px] text-slate-200">
                  {JSON.stringify(review.evidence || {}, null, 2)}
                </pre>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManage &&
                review.status === "pending" &&
                review.review_type === "response_warning" ? (
                  <button
                    disabled={busy}
                    onClick={() => void onApproveWarning(review)}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Publish 7-day response warning
                  </button>
                ) : null}
                {canManage &&
                review.status === "pending" &&
                ["suspension_timeout", "suspension_offline"].includes(
                  clean(review.review_type)
                ) ? (
                  <button
                    disabled={busy}
                    onClick={() => void onSuspend(review)}
                    className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Suspend 7 days
                  </button>
                ) : null}
                {canManage && review.status === "pending" ? (
                  <button
                    disabled={busy}
                    onClick={() => void onDismiss(review)}
                    className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                ) : (
                  <span className="rounded-full border px-3 py-1 text-xs font-bold uppercase">
                    {review.status}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
