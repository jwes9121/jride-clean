import type { SupabaseClient } from "@supabase/supabase-js";

export type ParticipationEntry = {
  attendeeId: string;
  funWalk: boolean;
  assist: boolean;
  lunchMeetGreet: boolean;
};

export type RecordParticipationResult = {
  ok: boolean;
  processed: number;
  error?: string;
};

// Fail-open by design (see EVT participation architecture decision): a
// participation write failure must never fail the registration itself. A
// person with a valid Event Pass but a missing participation row is
// recoverable later via the missing-participation reconciliation report
// (planned, not yet built). A person told registration failed when it
// actually succeeded is not recoverable in the same way - duplicate
// detection would just reopen their existing pass on retry, leaving them
// confused about whether anything went wrong.
//
// This function therefore never throws. Callers await it and may ignore
// the result entirely if they choose; failures are logged here so they are
// at least visible in server logs pending the reconciliation report.
//
// Uses upsert keyed on attendee_id (the table's own UNIQUE constraint)
// rather than insert, so this is safe to call again for the same attendee
// - a retried wrapper call or a future reconciliation tool won't be
// rejected by the unique constraint. updated_at is set explicitly on every
// call since no DB trigger maintains it - without this, a corrected value
// written on a second call would silently keep its original timestamp.
export async function recordParticipation(
  supabase: SupabaseClient,
  input: {
    eventId: string;
    entries: ParticipationEntry[];
  }
): Promise<RecordParticipationResult> {
  if (!input.entries.length) {
    return { ok: true, processed: 0 };
  }

  const now = new Date().toISOString();

  try {
    const { error } = await supabase.from("event_attendee_participation").upsert(
      input.entries.map((entry) => ({
        event_id: input.eventId,
        attendee_id: entry.attendeeId,
        fun_walk: entry.funWalk,
        assist: entry.assist,
        lunch_meet_greet: entry.lunchMeetGreet,
        updated_at: now,
      })),
      { onConflict: "attendee_id" }
    );

    if (error) {
      console.error("recordParticipation: upsert failed", {
        eventId: input.eventId,
        attendeeIds: input.entries.map((entry) => entry.attendeeId),
        message: error.message,
      });

      return { ok: false, processed: 0, error: error.message };
    }

    return { ok: true, processed: input.entries.length };
  } catch (error) {
    console.error("recordParticipation: unexpected error", {
      eventId: input.eventId,
      attendeeIds: input.entries.map((entry) => entry.attendeeId),
      message: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      processed: 0,
      error: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}
