
type TripStatus = "completed" | "cancelled" | "pending" | string;

export type TripSummary = {
  ref: string;
  dateLabel: string;
  service: "Ride";
  pickup: string;
  dropoff: string;
  payment?: string;
  farePhp?: number;
  distanceKm?: number;
  status: TripStatus;
  sortTs?: number;
  _raw?: any;
};

const EMPTY = "--";
function normalizeText(v: any): string {
  if (v === null || typeof v === "undefined") return EMPTY;
  let s = typeof v === "string" ? v : String(v);

  // Strip known mojibake markers + any remaining non-ASCII chars.
  s = s
    .replace(/ÃƒÆ’Ã†'Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬ Ãƒ¢Ã¢â€š¬Ã¢â€ž¢ÃƒÆ’Ã†'Ãƒâ€š¢ÃƒÆ’¢Ãƒ¢Ã¢â€š¬Ã…¡Ãƒâ€š¬ÃƒÆ’Ã¢â‚¬¦Ãƒâ€š¡/g, "")
    .replace(/ÃƒÆ’Ã†'Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬ Ãƒ¢Ã¢â€š¬Ã¢â€ž¢ÃƒÆ’Ã†'Ãƒ¢Ã¢â€š¬ ÃƒÆ’¢Ãƒ¢Ã¢â‚¬Å¡¬Ãƒ¢Ã¢â‚¬Å¾¢/g, "")
    .replace(/ÃƒÆ’Ã†'Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬ Ãƒ¢Ã¢â€š¬Ã¢â€ž¢ÃƒÆ’Ã†'Ãƒ¢Ã¢â€š¬Ã…¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€š¢/g, "")
    .trim();

  // Remove non-ASCII (last resort)
  s = s.replace(/[^\x20-\x7E]/g, "").trim();

  return s || EMPTY;
}

function peso(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return EMPTY;
  return "PHP " + n.toFixed(2);
}

function fareLabel(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return EMPTY;
  if (Math.abs(n) < 0.000001) return "Free ride";
  return peso(n);
}

function km(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return EMPTY;
  return n.toFixed(1) + " km";
}

function safeStr(v: any, fallback = ""): string {
  if (v === null || typeof v === "undefined") return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return fallback;
  }
}

function safeNum(v: any): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (isFinite(n)) return n;
  }
  return undefined;
}

function pickFirst(obj: any, keys: string[]): any {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== null &&
      typeof obj[k] !== "undefined"
    ) {
      return obj[k];
    }
  }
  return undefined;
}

function parseTs(v: any): number | undefined {
  const s = safeStr(v, "");
  if (!s) return undefined;
  const d = new Date(s);
  const t = d.getTime();
  return isFinite(t) ? t : undefined;
}

function fmtDateLabel(v: any): string {
  const s = safeStr(v, "");
  const d = s ? new Date(s) : null;
  if (d && !isNaN(d.getTime())) {
    return normalizeText(
      d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }
  return normalizeText(s) || EMPTY;
}

function computeFareFromComponents(r: any): number | undefined {
  const base = safeNum(pickFirst(r, ["base_fee"])) ?? 0;
  const dist = safeNum(pickFirst(r, ["distance_fare"])) ?? 0;
  const extraStop = safeNum(pickFirst(r, ["extra_stop_fee"])) ?? 0;
  const waiting = safeNum(pickFirst(r, ["waiting_fee"])) ?? 0;
  const errand = safeNum(pickFirst(r, ["total_errand_fee"])) ?? 0;

  const hasAny =
    typeof pickFirst(r, ["base_fee"]) !== "undefined" ||
    typeof pickFirst(r, ["distance_fare"]) !== "undefined" ||
    typeof pickFirst(r, ["extra_stop_fee"]) !== "undefined" ||
    typeof pickFirst(r, ["waiting_fee"]) !== "undefined" ||
    typeof pickFirst(r, ["total_errand_fee"]) !== "undefined";

  if (!hasAny) return undefined;

  const sum = base + dist + extraStop + waiting + errand;
  if (!isFinite(sum)) return undefined;
  return sum;
}

function computePayment(r: any): string | undefined {
  const cashMode = pickFirst(r, ["errand_cash_mode"]);
  if (cashMode === true || cashMode === "true" || cashMode === 1 || cashMode === "1") return "Cash";

  const pm = safeStr(pickFirst(r, ["payment_method", "payment_mode", "payment", "paid_via"]), "");
  const s = normalizeText(pm);
  if (s && s !== EMPTY) return s;

  return undefined;
}

export function normalizeTrips(payload: any): TripSummary[] {
  const arr: any[] =
    (Array.isArray(payload) ? payload : null) ||
    (payload && Array.isArray(payload.data) ? payload.data : null) ||
    (payload && Array.isArray(payload.items) ? payload.items : null) ||
    (payload && Array.isArray(payload.rides) ? payload.rides : null) ||
    [];

  const out: TripSummary[] = arr.map((r) => {
    const ref = safeStr(pickFirst(r, ["booking_code", "code", "ref", "reference", "id"]), EMPTY);

    const pickup = safeStr(
      pickFirst(r, ["from_label", "pickup_address", "pickup", "from_address", "from", "origin"]),
      EMPTY
    );

    const dropoff = safeStr(
      pickFirst(r, ["to_label", "dropoff_address", "dropoff", "to_address", "to", "destination"]),
      EMPTY
    );

    const farePhp =
      safeNum(pickFirst(r, ["verified_fare"])) ??
      safeNum(pickFirst(r, ["passenger_fare_response"])) ??
      safeNum(pickFirst(r, ["proposed_fare"])) ??
      safeNum(pickFirst(r, ["fare", "total_fare", "total"])) ??
      computeFareFromComponents(r);

    const distanceKm = safeNum(pickFirst(r, ["distance_km", "distanceKm"]));

    const status = safeStr(pickFirst(r, ["status", "ride_status", "state"]), "pending");
    const payment = computePayment(r);

    const created = pickFirst(r, ["created_at", "requested_at", "started_at", "completed_at", "updated_at"]);
    const dateLabel = fmtDateLabel(created);

    const sortTs =
      parseTs(pickFirst(r, ["updated_at"])) ??
      parseTs(pickFirst(r, ["completed_at"])) ??
      parseTs(pickFirst(r, ["created_at"])) ??
      parseTs(created) ??
      0;

    return {
      ref: normalizeText(ref),
      dateLabel: normalizeText(dateLabel),
      service: "Ride",
      pickup: normalizeText(pickup),
      dropoff: normalizeText(dropoff),
      payment,
      farePhp,
      distanceKm,
      status: normalizeText(status),
      sortTs,
      _raw: r,
    };
  });

  const completed = out.filter((t) => String(t.status).toLowerCase() === "completed");
  if (completed.length > 0) return completed;

  const doneLike = out.filter((t) => {
    const s = String(t.status).toLowerCase();
    return s === "done" || s === "finished" || s === "complete";
  });
  if (doneLike.length > 0) return doneLike;

  return out;
}
