import type { SupabaseClient } from "@supabase/supabase-js";

export interface NextRegistrationNumber {
  regSequence: number;
  registrationNumber: string;
}

export async function nextRegistrationNumber(
  supabase: SupabaseClient,
  eventId: string
): Promise<NextRegistrationNumber> {
  const { data, error } = await supabase.rpc("next_event_registration_number", {
    p_event_id: eventId,
  });

  if (error) {
    throw new Error(`Failed to generate registration number: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row.reg_sequence !== "number" || !row.registration_number) {
    throw new Error("Invalid registration number response");
  }

  return {
    regSequence: row.reg_sequence,
    registrationNumber: row.registration_number,
  };
}