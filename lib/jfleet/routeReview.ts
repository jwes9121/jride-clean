export const REVIEW_NOTICE = "Owner route approval records the agreed quotation basis. It is not permit verification, a road-safety guarantee, live tracking or an automatic detour alert.";
export const REVIEW_ACK = "I reviewed every stop, the road route, trip schedule, passenger/cargo needs and vehicle suitability. I checked access restrictions and any required itinerary changes.";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Decision = "approved" | "changes_requested";
export class ReviewInputError extends Error {}
export function parseReview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReviewInputError("Invalid review request.");
  const b = value as Record<string, unknown>;
  if (typeof b.inquiry_id !== "string" || !UUID.test(b.inquiry_id)) throw new ReviewInputError("Choose an inquiry.");
  if (typeof b.snapshot_hash !== "string" || !/^[a-f0-9]{64}$/.test(b.snapshot_hash)) throw new ReviewInputError("Reload the route before reviewing it.");
  if (b.decision !== "approved" && b.decision !== "changes_requested") throw new ReviewInputError("Choose Approve or Request Changes.");
  if (typeof b.notes !== "string" || b.notes.length > 1500) throw new ReviewInputError("Review notes must be text, up to 1500 characters.");
  if (b.decision === "approved" && b.acknowledged !== true) throw new ReviewInputError("Confirm that you reviewed the route and vehicle suitability.");
  if (b.decision === "changes_requested" && b.notes.trim().length < 3) throw new ReviewInputError("Explain the changes required.");
  return { inquiry_id: b.inquiry_id, snapshot_hash: b.snapshot_hash, decision: b.decision as Decision, notes: b.notes.trim(), acknowledged: b.acknowledged === true };
}
export function reviewFailure(message: string) {
  if (message.includes("OWNER_INQUIRY_NOT_FOUND")) return {status:404,code:"JFLEET_OWNER_INQUIRY_NOT_FOUND",message:"That inquiry is not available to this owner account."};
  if (message.includes("PINNED_ROUTE_REQUIRED")) return {status:409,code:"JFLEET_PINNED_ROUTE_REQUIRED",message:"This inquiry has no pinned road route. A pinned itinerary is required before review and quotation."};
  if (message.includes("REVIEW_STALE")) return {status:409,code:"JFLEET_ROUTE_REVIEW_STALE",message:"The itinerary, trip details or approval changed. Reload, review and approve the current version."};
  if (message.includes("REVIEW_CLOSED")) return {status:409,code:"JFLEET_ROUTE_REVIEW_CLOSED",message:"This inquiry is closed, already converted or past departure."};
  if (message.includes("REVIEW_REQUIRED")) return {status:409,code:"JFLEET_ROUTE_REVIEW_REQUIRED",message:"Open Route Review and approve the current itinerary before sending a quotation."};
  if (message.includes("REVIEW_INPUT_INVALID")) return {status:400,code:"JFLEET_ROUTE_REVIEW_INPUT_INVALID",message:"Check the review decision, acknowledgment and notes."};
  return {status:503,code:"JFLEET_ROUTE_REVIEW_UNAVAILABLE",message:"Route review could not be completed. Reload and try again."};
}
export type RouteContext = {
  ok: boolean; inquiry_code: string; status: string; quote_due_at: string;
  snapshot_hash: string; approved_review_id: string | null;
  snapshot: {
    inquiry_id: string; itinerary_id: string; itinerary_version: number; route_plan_id: string;
    points: { label: string; lat: number; lng: number; notes: string }[];
    route: { geometry: { type: "LineString"; coordinates: number[][] }; distance_m: number; duration_s: number; provider: string; profile: string };
    details: { purpose: string; vehicle_type: string; trip_mode: string; start_epoch: number; end_epoch: number; passenger_count: number | null; cargo_description: string | null; cargo_weight_kg: number | null; luggage_notes: string | null; special_notes: string | null };
  };
  history: { id: string; decision: Decision; notes: string; created_at: string; itinerary_id: string; snapshot_hash: string }[];
};
export function philippinesTime(value: string | number): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-PH", {timeZone:"Asia/Manila", dateStyle:"medium", timeStyle:"short"}) + " PHT" : "-";
}
