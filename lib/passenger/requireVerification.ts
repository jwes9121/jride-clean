import { passengerJson } from "@/lib/passenger/serverAuth";

// Only server-managed review records can approve a purchase. Profile metadata,
// a nonempty tier string, or permission to book at night is not an approval.
export async function requirePassengerVerification(admin: any, userId: string) {
  for (const [table, column] of [
    ["passenger_verifications", "user_id"],
    ["passenger_verification_requests", "passenger_id"],
  ]) {
    let result;
    try {
      result = await admin.from(table).select("status").eq(column, userId).maybeSingle();
    } catch {
      return passengerJson(503, { ok: false, error: "PASSENGER_VERIFICATION_UNAVAILABLE",
        message: "We could not check your account verification. Please try again." });
    }
    if (result.error) {
      // A missing legacy table is allowed; outages and ambiguous rows fail closed.
      if (["42P01", "PGRST205"].includes(String(result.error.code))) continue;
      return passengerJson(503, { ok: false, error: "PASSENGER_VERIFICATION_UNAVAILABLE",
        message: "We could not check your account verification. Please try again." });
    }
    const status = String(result.data?.status || "").trim().toLowerCase();
    if (!status) continue;
    if (["approved_admin", "approved", "verified"].includes(status)) return null;
    break;
  }
  return passengerJson(403, { ok: false, error: "PASSENGER_VERIFICATION_REQUIRED",
    message: "Your passenger account must be verified before placing an AgriMarket order." });
}
