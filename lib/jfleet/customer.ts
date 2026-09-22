import { parseRoutePoints, parseInquiryDetails } from "@/lib/jfleet/routePlanning";
import type { RouteContext } from "@/lib/jfleet/routeReview";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOKEN = /^[a-f0-9]{64}$/;
export class CustomerInputError extends Error {}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CustomerInputError("Invalid request.");
  return value as Record<string, unknown>;
}
export function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new CustomerInputError("Choose a valid inquiry or quotation.");
  return value;
}
export function contextToken(value: unknown): string {
  if (typeof value !== "string" || !TOKEN.test(value)) throw new CustomerInputError("Open the full quotation details and reload before continuing.");
  return value;
}
export function parseRevision(value: unknown) {
  const b=record(value);
  if (typeof b.reason !== "string" || b.reason.trim().length<3 || b.reason.length>1500) throw new CustomerInputError("Explain the revision in 3 to 1500 characters.");
  return {inquiry_id:id(b.inquiry_id),plan_id:id(b.plan_id),context_token:contextToken(b.context_token),
    reason:b.reason.trim(),points:parseRoutePoints(b.points),details:parseInquiryDetails(b.details)};
}
export function parseAcceptance(value: unknown) {
  const b=record(value);
  if (b.terms_acknowledged!==true) throw new CustomerInputError("Review the full quotation, inclusions, exclusions and payment/cancellation terms, then confirm the checkbox.");
  return {inquiry_id:id(b.inquiry_id),quote_id:id(b.quote_id),context_token:contextToken(b.context_token),terms_acknowledged:true};
}
export function customerFailure(message: string) {
  if (/NOT_FOUND/.test(message)) return {status:404,code:"JFLEET_CUSTOMER_NOT_FOUND",message:"That inquiry or route is not available to your account."};
  if (/STALE|CHANGED|RETRY_CONFLICT|ACCEPT_CONFLICT|REVIEW_REQUIRED/.test(message)) return {status:409,code:"JFLEET_CUSTOMER_STALE",message:"The inquiry, quotation or owner's decision changed. Reload and review it before continuing. Your edits have not been submitted."};
  if (/CLOSED|NOT_ACCEPTABLE/.test(message)) return {status:409,code:"JFLEET_CUSTOMER_CLOSED",message:"This inquiry is already accepted, closed or past departure. It cannot be revised or accepted again."};
  if (/EXPIRED|NOT_READY/.test(message)) return {status:409,code:"JFLEET_CUSTOMER_EXPIRED",message:"The route preview or quotation is expired or not ready. Refresh it before continuing."};
  if (/PINNED_ROUTE_REQUIRED/.test(message)) return {status:409,code:"JFLEET_PINNED_ROUTE_REQUIRED",message:"This older inquiry has no pinned road route. Use the map-pinned Request Quote flow."};
  if (/PARTNER_NOT_ACTIVE/.test(message)) return {status:503,code:"JFLEET_PARTNER_NOT_ACTIVE",message:"The transport partner is not accepting inquiries."};
  if (/INVALID|REQUIRED/.test(message)) return {status:400,code:"JFLEET_CUSTOMER_INPUT_INVALID",message:"Review the itinerary, dates and required fields."};
  return {status:503,code:"JFLEET_CUSTOMER_UNAVAILABLE",message:"The request could not be completed. Retry without changing the submitted details."};
}
export type CustomerQuote = {
  id:string; version_no:number; status:string; display_status:string; total_amount:number|string;
  currency:string; valid_until:string; inclusions:string|null; exclusions:string|null;
  pricing_notes:string|null; fuel_basis_note:string|null; sent_at:string;
  reservation_required_amount:number|string; snapshot:RouteContext["snapshot"]|null;
  items:{sequence_no:number;label:string;amount:number|string;included:boolean;notes:string|null}[];
};
export type CustomerContext = {
  ok:true; inquiry_id:string; inquiry_code:string; status:string; partner_name:string; quote_due_at:string;
  context_token:string; snapshot:RouteContext["snapshot"]; can_revise:boolean; actionable_quote_id:string|null;
  terms:{reservation_percent:number;free_cancel_hours:number;late_cancel_percent:number;quote_tat_minutes:number;free_cancel_until_epoch:number};
  quotes:CustomerQuote[];
  reviews:{id:string;decision:string;notes:string;created_at:string;itinerary_version:number}[];
  revisions:{id:string;reason:string;created_at:string;from_version:number;to_version:number}[];
  booking:{id:string;booking_code:string;status:string;payment_status:string;original_quote_amount:number|string;reservation_required_amount:number|string}|null;
  map_token?:string|null;
};
export function phtInput(epoch:number):string { return new Date(epoch*1000+28800000).toISOString().slice(0,16); }
export function money(amount:number|string):string {
  return "PHP "+Number(amount).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
}
