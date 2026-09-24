export type PassengerIdentity = {
  user_id: string;
  display_name: string | null;
  verified_full_name: string | null;
  phone: string | null;
  town: string | null;
  barangay: string | null;
  account_created_at: string | null;
  verification_status: string;
  verified_at: string | null;
  verification_submitted_at: string | null;
  verification_source: string | null;
  verification_record_id: string | null;
  id_type: string | null;
  has_id_front: boolean;
  has_id_back: boolean;
  has_selfie: boolean;
  verification_record_conflict: boolean;
  identity_name_mismatch: boolean | null;
};

export type PassengerActivity = {
  activity_id: string;
  service: string;
  code: string;
  booking_code: string | null;
  status: string | null;
  created_at: string | null;
  last_activity_at: string | null;
  origin_label: string | null;
  destination_label: string | null;
  cancel_reason: string | null;
};

export const IDENTITY_COLUMNS =
  "user_id,display_name,verified_full_name,phone,town,barangay,account_created_at," +
  "verification_status,verified_at,verification_submitted_at,verification_source," +
  "verification_record_id,id_type,has_id_front,has_id_back,has_selfie," +
  "verification_record_conflict,identity_name_mismatch";

export const ACTIVITY_COLUMNS =
  "activity_id,service,code,booking_code,status,created_at,last_activity_at," +
  "origin_label,destination_label,cancel_reason";

export const PASSENGER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type EvidenceKind = "id_front" | "id_back" | "selfie";

export function evidenceLocation(
  value: unknown,
  userId: string,
  kind: EvidenceKind,
  legacy: boolean,
  supabaseUrl: string
): { bucket: string; path: string } | null {
  if (typeof value !== "string" || !value.trim() || !PASSENGER_UUID.test(userId)) return null;
  let path = value.trim();
  let bucket = kind === "selfie" ? "passenger-selfies" : "passenger-ids";
  if (legacy && /^https:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.origin !== new URL(supabaseUrl).origin || url.username || url.password) return null;
      const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/(passenger-ids|passenger-selfies)\/(.+)$/);
      if (!match) return null;
      bucket = match[1];
      path = decodeURIComponent(match[2]);
    } catch { return null; }
  }
  // Never fetch arbitrary URLs or sign another passenger's object.
  if (/[\\?#%\u0000-\u001f\u007f]/.test(path) || path.includes("://")) return null;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  const expectedPrefix = kind === "selfie" ? "selfie_with_id" : kind;
  const ownsPath =
    (parts.length === 2 && parts[0] === userId) ||
    (parts.length === 3 && parts[0] === expectedPrefix && parts[1] === userId);
  if (!ownsPath || (kind !== "selfie" && bucket !== "passenger-ids")) return null;
  return { bucket, path };
}
