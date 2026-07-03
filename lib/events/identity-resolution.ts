import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdentityResolution } from "./types";

function normalizeName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ");
}

export async function resolveIdentity(
  supabase: SupabaseClient,
  input: {
    eventId: string;
    fullName: string;
    mobileNumber: string;
    groupValue: string;
  }
): Promise<IdentityResolution> {
  const mobileNumber = String(input.mobileNumber || "").trim();
  const fullName = String(input.fullName || "").trim();
  const groupValue = String(input.groupValue || "").trim();

  const mobileMatch = await supabase
    .from("event_attendees")
    .select("id,registration_number,full_name,group_value")
    .eq("event_id", input.eventId)
    .eq("mobile_number", mobileNumber)
    .is("merged_into", null)
    .maybeSingle();

  if (mobileMatch.data) {
    return {
      isDuplicate: true,
      confidence: "high",
      matchedAttendeeId: mobileMatch.data.id,
      registrationNumber: mobileMatch.data.registration_number,
      matchReasons: ["mobile_match"],
      requiresReview: false,
    };
  }

  const sameGroup = await supabase
    .from("event_attendees")
    .select("id,registration_number,full_name,group_value")
    .eq("event_id", input.eventId)
    .eq("group_value", groupValue)
    .is("merged_into", null)
    .limit(50);

  const normalizedNewName = normalizeName(fullName);

  for (const row of sameGroup.data || []) {
    const existingName = normalizeName(String(row.full_name || ""));
    if (existingName && existingName === normalizedNewName) {
      return {
        isDuplicate: true,
        confidence: "high",
        matchedAttendeeId: row.id,
        registrationNumber: row.registration_number,
        matchReasons: ["name_match", "same_group"],
        requiresReview: true,
      };
    }
  }

  return {
    isDuplicate: false,
    confidence: "low",
    matchReasons: [],
    requiresReview: false,
  };
}