export type PassengerBookingIdentitySource =
  | "approved_verification"
  | "approved_verification_request"
  | "passenger_profile"
  | "missing";

export type PassengerBookingIdentity = {
  name: string | null;
  source: PassengerBookingIdentitySource;
};

function normalizeStoredPassengerName(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function usableName(value: unknown): string | null {
  const name = normalizeStoredPassengerName(value);
  return name.length >= 2 ? name : null;
}

export async function resolvePassengerBookingIdentity(
  supabase: any,
  userId: string
): Promise<PassengerBookingIdentity> {
  const id = String(userId ?? "").trim();
  if (!id) {
    return { name: null, source: "missing" };
  }

  try {
    const verified = await supabase
      .from("passenger_verifications")
      .select("full_name")
      .eq("user_id", id)
      .eq("status", "approved_admin")
      .limit(1);

    const name = usableName(verified.data?.[0]?.full_name);
    if (!verified.error && name) {
      return { name, source: "approved_verification" };
    }
  } catch {}

  try {
    const approvedRequest = await supabase
      .from("passenger_verification_requests")
      .select("full_name")
      .eq("passenger_id", id)
      .eq("status", "approved")
      .limit(1);

    const name = usableName(approvedRequest.data?.[0]?.full_name);
    if (!approvedRequest.error && name) {
      return { name, source: "approved_verification_request" };
    }
  } catch {}

  try {
    const profile = await supabase
      .from("passenger_profiles")
      .select("full_name")
      .eq("user_id", id)
      .limit(1);

    const name = usableName(profile.data?.[0]?.full_name);
    if (!profile.error && name) {
      return { name, source: "passenger_profile" };
    }
  } catch {}

  return { name: null, source: "missing" };
}