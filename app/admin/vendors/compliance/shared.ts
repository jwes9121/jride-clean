export type ViolationOption = {
  code: string;
  label: string;
  defaultMessage: string;
};

export type ManualSuspendPayload = {
  vendor_id: string;
  violation_code: string;
  vendor_message: string;
  internal_note: string;
  duration_days: number;
  request_id: string;
};

export const VIOLATION_OPTIONS: ViolationOption[] = [
  {
    code: "REPEATED_ORDER_TIMEOUTS",
    label: "Repeated expired Takeout orders",
    defaultMessage:
      "Your store did not respond to multiple Takeout orders within the required response time.",
  },
  {
    code: "REPEATED_UNEXCUSED_OFFLINE_DAYS",
    label: "Repeated unexcused offline days",
    defaultMessage:
      "Your store was unavailable for multiple scheduled operating days without an approved closure.",
  },
  {
    code: "CUSTOMER_COMPLAINT",
    label: "Confirmed customer complaint",
    defaultMessage:
      "JRide confirmed a customer complaint that violated the vendor participation rules.",
  },
  {
    code: "FALSE_OR_MISLEADING_MENU",
    label: "False or misleading menu information",
    defaultMessage:
      "JRide found inaccurate or misleading menu, pricing, or availability information on your store.",
  },
  {
    code: "PRICE_OR_ORDER_MANIPULATION",
    label: "Price or order manipulation",
    defaultMessage:
      "JRide found an unauthorized change to an order price, item, or transaction outside the JRide process.",
  },
  {
    code: "ABUSIVE_CONDUCT",
    label: "Abusive or inappropriate conduct",
    defaultMessage:
      "JRide confirmed inappropriate conduct involving a customer, driver, or JRide staff member.",
  },
  {
    code: "FOOD_OR_PRODUCT_SAFETY",
    label: "Food or product safety concern",
    defaultMessage:
      "JRide identified a food or product safety concern that requires a temporary suspension.",
  },
  {
    code: "TERMS_OF_SERVICE_VIOLATION",
    label: "Other vendor participation rule violation",
    defaultMessage:
      "JRide confirmed a violation of the vendor participation rules.",
  },
  {
    code: "OTHER",
    label: "Other reviewed violation",
    defaultMessage: "",
  },
];

export function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function fmt(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "";
}

export function vendorName(vendor: any): string {
  return clean(vendor?.display_name || vendor?.email || vendor?.id || "Vendor");
}

export function isActiveSanction(row: any): boolean {
  return (
    clean(row?.status) === "active" &&
    new Date(row?.ends_at).getTime() > Date.now()
  );
}

export function isSuspension(row: any): boolean {
  return ["suspension_7_days", "manual"].includes(clean(row?.sanction_type));
}
