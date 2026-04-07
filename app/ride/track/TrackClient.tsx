"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const TOKEN_KEY = "jride_access_token";

type TrackResponse = {
  ok?: boolean;
  booking_code?: string | null;
  status?: string | null;
  id?: string | null;
  booking_id?: string | null;

  driver_name?: string | null;
  driver_phone?: string | null;
  proposed_fare?: number | null;
  verified_fare?: number | null;
  fare?: number | null;
  pickup_distance_fee?: number | null;
  platform_fee?: number | null;
  total_fare?: number | null;
  total_amount?: number | null;
  grand_total?: number | null;
  driver_to_pickup_km?: number | null;
  trip_distance_km?: number | null;
  updated_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  message?: string | null;

  driver?: {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
  } | null;

  route?: {
    distance_km?: number | null;
    eta_minutes?: number | null;
    trip_km?: number | null;
    driver_to_pickup_km?: number | null;
    trip_distance_km?: number | null;
  } | null;
};

function getToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

function numValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function money(v?: number | null): string {
  return typeof v === "number" && Number.isFinite(v) ? `PHP ${v.toFixed(0)}` : "--";
}

function km(v?: number | null): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} km` : "--";
}

function fmtDate(v?: string | null): string {
  const s = String(v ?? "").trim();
  if (!s) return "--";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normStatus(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function statusMessage(statusRaw: unknown): string {
  const st = normStatus(statusRaw);
  if (st === "searching") return "Looking for a nearby driver.";
  if (st === "assigned") return "A driver has been assigned to your booking.";
  if (st === "accepted") return "Your driver accepted the booking.";
  if (st === "fare_proposed") return "Your driver proposed a fare.";
  if (st === "ready") return "Fare accepted. Driver is preparing to proceed.";
  if (st === "on_the_way") return "Driver is on the way to your pickup point.";
  if (st === "arrived") return "Driver has arrived at the pickup point.";
  if (st === "on_trip") return "Trip is now in progress.";
  if (st === "completed") return "Trip completed successfully.";
  if (st === "cancelled") return "This trip was cancelled.";
  if (st === "rejected") return "This trip was rejected.";
  return "Updating trip status...";
}

type RatingSnapshot = {
  id?: string | null;
  rating?: number | null;
  feedback?: string | null;
  created_at?: string | null;
};

type RatingCheckResponse = {
  ok?: boolean;
  booking_id?: string | null;
  booking_code?: string | null;
  booking_status?: string | null;
  can_rate?: boolean;
  already_rated?: boolean;
  rating?: RatingSnapshot | null;
  error?: string | null;
  message?: string | null;
};

function statusTone(statusRaw: unknown): "blue" | "amber" | "green" | "red" | "slate" {
  const st = normStatus(statusRaw);
  if (["searching", "assigned", "accepted", "ready", "on_the_way", "on_trip"].includes(st)) return "blue";
  if (st === "fare_proposed" || st === "arrived") return "amber";
  if (st === "completed") return "green";
  if (st === "cancelled" || st === "rejected") return "red";
  return "slate";
}

export default function TrackClient({ code }: { code?: string }) {
  const [data, setData] = useState<TrackResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [fareBusy, setFareBusy] = useState(false);
  const [ratingCheckLoading, setRatingCheckLoading] = useState(false);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingErr, setRatingErr] = useState("");
  const [ratingInfo, setRatingInfo] = useState<RatingCheckResponse | null>(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingFeedback, setRatingFeedback] = useState("");
  const [ratingThanks, setRatingThanks] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchTrack() {
    if (!code) {
      setErr("Missing booking code.");
      setData(null);
      return;
    }

    setLoading(true);
    setErr("");

    try {
      const token = getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      const res = await fetch(
        `/api/passenger/track?booking_code=${encodeURIComponent(code)}&ts=${Date.now()}`,
        {
          cache: "no-store",
          headers,
        }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setData(null);
        setErr(json?.message || json?.error || "Unable to load trip tracking.");
        return;
      }

      const booking = (json?.booking || json) as TrackResponse;
      setData(booking);
    } catch {
      setData(null);
      setErr("Unable to load trip tracking.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshRatingState(bookingCode: string) {
    const trimmedCode = String(bookingCode || "").trim();
    if (!trimmedCode) {
      setRatingInfo(null);
      setRatingErr("");
      setRatingThanks(false);
      return;
    }

    setRatingCheckLoading(true);
    setRatingErr("");

    try {
      const token = getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/rides/rate?booking_code=${encodeURIComponent(trimmedCode)}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as RatingCheckResponse | null;

      if (!res.ok || !json?.ok) {
        setRatingInfo(null);
        setRatingThanks(false);
        setRatingErr(json?.message || json?.error || "Unable to load survey status.");
        return;
      }

      setRatingInfo(json);
      if (json?.rating?.rating && Number.isFinite(Number(json.rating.rating))) {
        setRatingValue(Math.max(1, Math.min(5, Number(json.rating.rating))));
      } else {
        setRatingValue(5);
      }
      setRatingFeedback(String(json?.rating?.feedback || "").trim());
      setRatingThanks(!!json?.already_rated);
    } catch {
      setRatingInfo(null);
      setRatingThanks(false);
      setRatingErr("Unable to load survey status.");
    } finally {
      setRatingCheckLoading(false);
    }
  }

  async function submitRating() {
    const trimmedCode = String(code || "").trim();
    if (!trimmedCode) {
      setRatingErr("Missing booking code.");
      return;
    }

    setRatingSubmitting(true);
    setRatingErr("");

    try {
      const token = getToken();
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/rides/rate", {
        method: "POST",
        headers,
        body: JSON.stringify({
          booking_code: trimmedCode,
          rating: ratingValue,
          feedback: ratingFeedback.slice(0, 120),
        }),
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setRatingErr(json?.message || json?.error || "Unable to submit survey.");
        return;
      }

      setRatingFeedback(String(ratingFeedback || "").slice(0, 120));
      setRatingThanks(true);
      await refreshRatingState(trimmedCode);
    } catch {
      setRatingErr("Unable to submit survey.");
    } finally {
      setRatingSubmitting(false);
    }
  }

  async function postFareResponse(response: "accepted" | "rejected") {
    const bookingId = String(data?.id || data?.booking_id || "").trim();
    if (!bookingId) {
      setErr("Missing booking id for fare response.");
      return;
    }

    setFareBusy(true);
    setErr("");

    try {
      const token = getToken();
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/rides/fare-response", {
        method: "POST",
        headers,
        body: JSON.stringify({
          booking_id: bookingId,
          response,
        }),
        cache: "no-store",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || (json && json.ok === false)) {
        setErr(json?.message || json?.error || "Unable to submit fare response.");
        return;
      }

      await fetchTrack();
    } catch {
      setErr("Unable to submit fare response.");
    } finally {
      setFareBusy(false);
    }
  }

  useEffect(() => {
    fetchTrack();

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    pollRef.current = setInterval(fetchTrack, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [code]);

  const liveStatus = normStatus(data?.status);

  useEffect(() => {
    if (liveStatus === "completed" && code) {
      refreshRatingState(code);
      return;
    }
    setRatingInfo(null);
    setRatingErr("");
    setRatingThanks(false);
  }, [liveStatus, code]);

  const driverName = useMemo(() => {
    const flat = String(data?.driver_name || "").trim();
    if (flat) return flat;

    const nested = String(data?.driver?.name || "").trim();
    if (nested) return nested;

    if (["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip", "completed"].includes(liveStatus)) {
      return "Driver assigned";
    }

    return "--";
  }, [data, liveStatus]);

  const driverPhone = useMemo(() => {
    const flat = String(data?.driver_phone || "").trim();
    if (flat) return flat;

    const nested = String(data?.driver?.phone || "").trim();
    if (nested) return nested;

    return "--";
  }, [data]);

  const driverToPickupKm = useMemo(() => {
    return (
      numValue(data?.driver_to_pickup_km) ??
      numValue(data?.route?.driver_to_pickup_km) ??
      numValue(data?.route?.distance_km)
    );
  }, [data]);

  const tripDistanceKm = useMemo(() => {
    return (
      numValue(data?.trip_distance_km) ??
      numValue(data?.route?.trip_distance_km) ??
      numValue(data?.route?.trip_km)
    );
  }, [data]);

  const liveFare = useMemo(() => {
    return (
      numValue(data?.verified_fare) ??
      numValue(data?.proposed_fare) ??
      numValue(data?.fare)
    );
  }, [data]);

  const pickupDistanceFee = useMemo(() => numValue(data?.pickup_distance_fee), [data]);
  const platformFee = useMemo(() => numValue(data?.platform_fee), [data]);

  const backendTotal = useMemo(() => {
    return (
      numValue(data?.total_fare) ??
      numValue(data?.total_amount) ??
      numValue(data?.grand_total)
    );
  }, [data]);

  const fallbackTotal = useMemo(() => {
    if (liveFare == null) return null;
    return liveFare + (pickupDistanceFee ?? 0) + (platformFee ?? 0);
  }, [liveFare, pickupDistanceFee, platformFee]);

  const liveTotal = backendTotal ?? fallbackTotal;
  const totalIsFallback = backendTotal == null && fallbackTotal != null;

  const bannerTone = statusTone(liveStatus);
  const bannerClass =
    bannerTone === "amber"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : bannerTone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : bannerTone === "red"
      ? "border-red-300 bg-red-50 text-red-900"
      : bannerTone === "blue"
      ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
      : "border-slate-300 bg-slate-50 text-slate-800";

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Tracking</div>
        <div className="text-xs opacity-70">Code: {code || "--"}</div>
      </div>

      {data ? (
        <div className={`rounded-xl border p-4 text-sm shadow-sm ${bannerClass}`}>
          <div className="font-semibold">Current trip status</div>
          <div className="mt-1">{statusMessage(liveStatus)}</div>
          <div className="mt-2 text-[11px] opacity-75">Status: {liveStatus || "--"}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-black/10 bg-white p-4 text-sm">
          Loading tracking...
        </div>
      ) : null}

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="rounded-xl border border-black/10 bg-white p-4 space-y-2">
            <div className="text-sm font-semibold">Trip summary</div>
            <div>Status: {liveStatus || "--"}</div>
            <div>Driver: {driverName}</div>
            <div>Phone: {driverPhone}</div>
            <div>Driver to pickup: {km(driverToPickupKm)}</div>
            <div>Trip distance: {km(tripDistanceKm)}</div>
            <div>Updated: {fmtDate(data.updated_at)}</div>
          </div>

          <div className={`rounded-xl border p-4 space-y-3 ${liveStatus === "fare_proposed" ? "border-amber-200 bg-amber-50/50" : "border-black/10 bg-white"}`}>
            <div>
              <div className={`text-sm font-semibold ${liveStatus === "fare_proposed" ? "text-amber-900" : "text-slate-900"}`}>
                {liveStatus === "fare_proposed" ? "Driver proposed fare" : "Trip fare summary"}
              </div>
              <div className="mt-1 text-xs opacity-70">
                {liveStatus === "fare_proposed"
                  ? "Accept to continue or reject to request a new quote."
                  : "Fare, pickup fee, and total shown for this trip."}
              </div>
            </div>

            <div className="space-y-1 text-sm">
              <div>Fare: {money(liveFare)}</div>
              {(pickupDistanceFee != null && pickupDistanceFee > 0) || driverToPickupKm != null ? (
                <div>
                  Pickup: {km(driverToPickupKm)} | {pickupDistanceFee != null ? money(pickupDistanceFee) : "--"}
                </div>
              ) : null}
              {platformFee != null ? <div>Platform fee: {money(platformFee)}</div> : null}
            </div>

            <div className="border-t border-black/10 pt-3">
              <div className="text-base font-bold">Total to pay: {liveTotal != null ? money(liveTotal) : "--"}</div>
              {totalIsFallback ? (
                <div className="mt-1 text-[11px] opacity-70">Shown as display fallback while backend total is unavailable.</div>
              ) : null}
              {liveTotal == null ? (
                <div className="mt-1 text-[11px] opacity-70">Waiting for backend total.</div>
              ) : null}
            </div>

            {liveStatus === "fare_proposed" ? (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => postFareResponse("accepted")}
                  disabled={fareBusy}
                  className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-400 disabled:opacity-50"
                >
                  Accept fare
                </button>
                <button
                  type="button"
                  onClick={() => postFareResponse("rejected")}
                  disabled={fareBusy}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Reject / new quote
                </button>
              </div>
            ) : null}
          </div>

          {["completed", "cancelled", "rejected"].includes(liveStatus) ? (
            <div className="rounded-xl border border-black/10 bg-white p-4 space-y-3">
              <div className="text-sm font-semibold">{liveStatus === "completed" ? "Trip receipt" : "Trip summary"}</div>
              <div>Driver: {driverName}</div>
              <div>Fare: {money(liveFare)}</div>
              <div>Pickup fee: {money(pickupDistanceFee)}</div>
              <div>Platform fee: {money(platformFee)}</div>
              <div>Total: {money(liveTotal)}</div>
              <div>Driver to pickup: {km(driverToPickupKm)}</div>
              <div>Trip distance: {km(tripDistanceKm)}</div>
              <div>
                {liveStatus === "completed" ? "Completed" : "Cancelled"}:{" "}
                {fmtDate(liveStatus === "completed" ? data.completed_at : data.cancelled_at || data.updated_at)}
              </div>

              {liveStatus === "completed" ? (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Rate your driver</div>
                    <div className="text-xs text-slate-500">1 star is lowest, 5 stars is highest. Help us improve our services.</div>
                  </div>

                  {ratingCheckLoading ? (
                    <div className="text-xs text-slate-500">Checking survey status...</div>
                  ) : ratingInfo?.already_rated && ratingInfo?.rating ? (
                    <div className="space-y-1 text-sm text-slate-700">
                      <div>Your rating: {String(ratingInfo.rating.rating || "--")} / 5</div>
                      <div>Feedback: {String(ratingInfo.rating.feedback || "").trim() || "--"}</div>
                      <div className="text-xs text-slate-500">Submitted: {fmtDate(ratingInfo.rating.created_at)}</div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {[1, 2, 3, 4, 5].map((star) => {
                          const active = ratingValue === star;
                          return (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setRatingValue(star)}
                              className={
                                "rounded-xl px-3 py-2 text-sm font-semibold shadow-sm " +
                                (active
                                  ? "bg-emerald-500 text-white"
                                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50")
                              }
                            >
                              {star} star{star > 1 ? "s" : ""}
                            </button>
                          );
                        })}
                      </div>

                      <div>
                        <textarea
                          className="min-h-[96px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                          placeholder="Help us improve our services"
                          value={ratingFeedback}
                          maxLength={120}
                          onChange={(e) => setRatingFeedback(e.target.value.slice(0, 120))}
                        />
                        <div className="mt-1 text-right text-[11px] text-slate-500">{ratingFeedback.length}/120</div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={submitRating}
                          disabled={ratingSubmitting || !!ratingCheckLoading || ratingInfo?.can_rate === false}
                          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-400 disabled:opacity-50"
                        >
                          {ratingSubmitting ? "Submitting..." : "Submit rating"}
                        </button>
                        {ratingThanks ? <span className="text-xs text-emerald-700">Thank you for your feedback.</span> : null}
                      </div>
                    </>
                  )}

                  {ratingErr ? <div className="text-xs text-red-600">{ratingErr}</div> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}