"use client";

import { useEffect, useMemo, useState } from "react";

type FareBreakdown = {
  items_total: number;
  delivery_fee: number;
  platform_fee: number;
  other_fees: number;
  grand_total: number;
};

type Order = {
  id?: string | number;
  booking_code?: string;
  created_at?: string | null;
  updated_at?: string | null;
  fare_breakdown?: Partial<FareBreakdown> | null;
  [key: string]: any;
};

type VendorRatingOrder = {
  booking_code: string;
  rating_avg?: number | string | null;
  rating_count?: number | string | null;
  rating_comment?: string | null;
};

type VendorRatingsResponse = {
  orders?: VendorRatingOrder[];
};

type PageProps = {
  params: { bookingCode: string };
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n: number): string {
  return `₱${n.toFixed(2)}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function buildReceiptUrl(bookingCode: string): string {
  if (typeof window === "undefined") {
    return `/takeout/orders/${encodeURIComponent(bookingCode)}/receipt`;
  }
  return `${window.location.origin}/takeout/orders/${encodeURIComponent(
    bookingCode
  )}/receipt`;
}

export default function TakeoutReceiptPage({ params }: PageProps) {
  const bookingCode = decodeURIComponent(params.bookingCode || "");

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [savingRating, setSavingRating] = useState(false);
  const [ratingSaved, setRatingSaved] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingCode) return;

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        // 1) Load order details
        const orderRes = await fetch(
          `/api/orders/${encodeURIComponent(bookingCode)}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        if (!orderRes.ok) {
          const body = await orderRes.json().catch(() => ({}));
          throw new Error(
            body?.error || `Failed with status ${orderRes.status}`
          );
        }

        const body = await orderRes.json();
        const o: Order = (body.booking ?? body.order ?? body) as Order;
        if (!cancelled) {
          setOrder(o);
        }

        // 2) Prefill rating + comment from /api/takeout/vendor-ratings
        try {
          const ratingsRes = await fetch("/api/takeout/vendor-ratings", {
            method: "GET",
            cache: "no-store",
          });

          if (ratingsRes.ok) {
            const ratingsBody = (await ratingsRes.json()) as VendorRatingsResponse;
            const match = ratingsBody.orders?.find(
              (r) => r.booking_code === bookingCode
            );

            if (match && !cancelled) {
              const count = num(match.rating_count);
              const avg = num(match.rating_avg);

              if (count > 0 && avg > 0) {
                const stars = Math.max(1, Math.min(5, Math.round(avg)));
                setRating(stars);
                setRatingSaved(true); // lock it (already rated)
              }

              if (match.rating_comment) {
                setComment(match.rating_comment);
              }
            }
          }
        } catch (err) {
          console.error("Failed to prefill rating from vendor-ratings:", err);
        }
      } catch (err: any) {
        console.error("Failed to load receipt:", err);
        if (!cancelled) {
          setError(err?.message || "Failed to load receipt");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [bookingCode]);

  const fare: FareBreakdown = useMemo(() => {
    const fb = order?.fare_breakdown ?? {};
    return {
      items_total: num(
        (fb as FareBreakdown).items_total ?? (order as any)?.items_total
      ),
      delivery_fee: num(
        (fb as FareBreakdown).delivery_fee ?? (order as any)?.delivery_fee
      ),
      platform_fee: num(
        (fb as FareBreakdown).platform_fee ?? (order as any)?.platform_fee
      ),
      other_fees: num(
        (fb as FareBreakdown).other_fees ?? (order as any)?.other_fees
      ),
      grand_total: num(
        (fb as FareBreakdown).grand_total ?? (order as any)?.grand_total
      ),
    };
  }, [order]);

  async function handleSubmitRating() {
    if (ratingSaved) return;

    if (!rating || rating < 1 || rating > 5) {
      setRatingError("Please select a rating from 1 to 5 stars.");
      return;
    }

    try {
      setSavingRating(true);
      setRatingError(null);

      const res = await fetch(
        `/api/orders/${encodeURIComponent(bookingCode)}/rating`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rating,
            comment: comment || null,
          }),
        }
      );

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body?.error || `Failed with status ${res.status}`);
      }

      // After a successful save, lock stars + button
      setRatingSaved(true);
    } catch (err: any) {
      console.error("Failed to submit rating:", err);
      setRatingError(err?.message || "Failed to submit rating");
    } finally {
      setSavingRating(false);
    }
  }

  function handlePrint() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  async function handleCopyLink() {
    try {
      const url = buildReceiptUrl(bookingCode);
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopyMessage("Receipt link copied.");
        setTimeout(() => setCopyMessage(null), 2500);
      } else {
        window.prompt("Copy this receipt link:", url);
      }
    } catch (err) {
      console.error("Failed to copy link:", err);
      setCopyMessage("Failed to copy link.");
      setTimeout(() => setCopyMessage(null), 2500);
    }
  }

  const starsDisabled = savingRating || ratingSaved;
  const effectiveRating = hoverRating || rating;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">
          Loading receipt…
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="max-w-md rounded-2xl bg-white px-6 py-5 text-sm text-slate-700 shadow-sm">
          <div className="text-base font-semibold text-slate-900">
            Unable to load receipt
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {error ??
              "We could not load this order. Please check the link or try again later."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
        {/* Header / receipt info */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wide text-emerald-600">
                THANK YOU FOR YOUR ORDER
              </p>
              <h1 className="mt-1 text-lg font-semibold text-slate-900">
                Takeout receipt
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Order code:{" "}
                <span className="font-mono font-semibold text-slate-900">
                  {order.booking_code ?? bookingCode}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Completed at:{" "}
                {formatDateTime(order.updated_at ?? order.created_at ?? null)}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:items-end">
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-slate-800"
              >
                Download / print receipt
              </button>
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Copy receipt link
              </button>
              {copyMessage && (
                <p className="text-[11px] text-slate-400">{copyMessage}</p>
              )}
            </div>
          </div>
        </section>

        {/* Fare breakdown */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Fare breakdown
          </h2>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <div className="flex items-center justify-between">
              <span>Items total</span>
              <span className="font-medium">{formatMoney(fare.items_total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Delivery fee</span>
              <span className="font-medium">
                {formatMoney(fare.delivery_fee)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Platform fee</span>
              <span className="font-medium">
                {formatMoney(fare.platform_fee)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Other fees</span>
              <span className="font-medium">
                {formatMoney(fare.other_fees)}
              </span>
            </div>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-900">
                  Total paid
                </span>
                <span className="font-semibold text-emerald-600">
                  {formatMoney(fare.grand_total)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Rating section */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Rate your experience
          </h2>

          <div className="mt-3 flex items-center gap-1">
            {([1, 2, 3, 4, 5] as const).map((star) => {
              const filled = effectiveRating >= star;
              const colorClass = ratingSaved
                ? filled
                  ? "text-amber-300"
                  : "text-slate-300"
                : filled
                ? "text-amber-400"
                : "text-slate-300";

              return (
                <button
                  key={star}
                  type="button"
                  disabled={starsDisabled}
                  onMouseEnter={
                    starsDisabled ? undefined : () => setHoverRating(star)
                  }
                  onMouseLeave={
                    starsDisabled ? undefined : () => setHoverRating(0)
                  }
                  onClick={
                    starsDisabled ? undefined : () => setRating(star)
                  }
                  className={`h-8 w-8 rounded-lg text-xl transition-transform ${
                    starsDisabled
                      ? "cursor-default"
                      : "cursor-pointer hover:scale-110"
                  } ${colorClass}`}
                >
                  ★
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                ratingSaved
                  ? "Your feedback for this order."
                  : "Anything you want to share about the food, the rider, or the app? (optional)"
              }
              disabled={starsDisabled}
              className="h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-1 focus:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>

          {ratingError && (
            <p className="mt-2 text-xs text-red-500">{ratingError}</p>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={handleSubmitRating}
              disabled={starsDisabled}
              className={`rounded-full px-4 py-2 text-xs font-semibold shadow-sm ${
                ratingSaved
                  ? "bg-slate-300 text-slate-600 cursor-default"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {savingRating
                ? "Saving..."
                : ratingSaved
                ? "Rating submitted"
                : "Submit rating"}
            </button>
            {ratingSaved && (
              <p className="text-[11px] text-slate-500">
                Thank you! Your rating and comment have been recorded.
              </p>
            )}
          </div>

          <p className="mt-4 text-[11px] text-slate-400">
            You may screenshot this page, print it, or show it to the vendor as
            proof of payment.
          </p>
        </section>
      </div>
    </div>
  );
}