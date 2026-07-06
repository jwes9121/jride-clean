import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEventPass } from "./event-pass";
import { resolveIdentity } from "./identity-resolution";
import { nextRegistrationNumber } from "./registration-number";
import type {
  EventRegistrationRequest,
  RegistrationContext,
  RegistrationResult,
  RegisteredGuestResult,
} from "./types";
import { validateRegistration } from "./validation";

async function getEvent(supabase: SupabaseClient, eventSlug: string) {
  const { data, error } = await supabase
    .from("events")
    .select("id,slug,status")
    .eq("slug", eventSlug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

async function getAttendeeTypeId(
  supabase: SupabaseClient,
  eventId: string,
  typeKey: string
): Promise<string> {
  const { data, error } = await supabase
    .from("event_attendee_types")
    .select("id")
    .eq("event_id", eventId)
    .eq("type_key", typeKey)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error(`Missing attendee type: ${typeKey}`);

  return data.id;
}

async function getExistingRegistration(
  supabase: SupabaseClient,
  attendeeId: string
): Promise<RegistrationResult> {
  const { data, error } = await supabase
    .from("event_attendees")
    .select("id,full_name,registration_number,qr_token")
    .eq("id", attendeeId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!data?.id || !data.registration_number || !data.qr_token) {
    return {
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Existing registration could not be loaded.",
      },
    };
  }

  const pass = buildEventPass({
    registrationNumber: data.registration_number,
    qrToken: data.qr_token,
  });

  return {
    success: true,
    attendeeId: data.id,
    registrationNumber: pass.registrationNumber,
    qrToken: pass.qrToken,
    eventPassUrl: pass.passUrl,
    existingRegistration: true,
    existingName: data.full_name,
    message: `This mobile number is already registered. Opening existing Event Pass for ${data.full_name}.`,
  };
}

async function insertGuest(
  supabase: SupabaseClient,
  input: {
    eventId: string;
    guestTypeId: string;
    primaryAttendeeId: string;
    fullName: string;
    relationship: string;
    source: string;
    registeredBy?: string;
  }
): Promise<RegisteredGuestResult> {
  const nextNumber = await nextRegistrationNumber(supabase, input.eventId);

  const { data: guest, error } = await supabase
    .from("event_attendees")
    .insert({
      event_id: input.eventId,
      attendee_type_id: input.guestTypeId,
      full_name: input.fullName,
      mobile_number: null,
      phone_declined: true,
      group_value: "Guest",
      registration_source: input.source,
      reg_sequence: nextNumber.regSequence,
      registration_number: nextNumber.registrationNumber,
      created_by: input.registeredBy || null,
    })
    .select("id,registration_number,qr_token,full_name")
    .single();

  if (error) throw new Error(error.message);

  const { error: linkError } = await supabase.from("event_guest_links").insert({
    event_id: input.eventId,
    primary_attendee_id: input.primaryAttendeeId,
    guest_attendee_id: guest.id,
    relationship: input.relationship,
    has_own_qr: true,
  });

  if (linkError) throw new Error(linkError.message);

  const pass = buildEventPass({
    registrationNumber: guest.registration_number,
    qrToken: guest.qr_token,
  });

  return {
    attendeeId: guest.id,
    registrationNumber: pass.registrationNumber,
    qrToken: pass.qrToken,
    passUrl: pass.passUrl,
    fullName: guest.full_name,
    relationship: input.relationship,
  };
}

export async function registerAttendee(
  supabase: SupabaseClient,
  request: EventRegistrationRequest,
  context: RegistrationContext
): Promise<RegistrationResult> {
  try {
    const validated = validateRegistration(request);

    if (!validated.ok || !validated.cleaned) {
      return { success: false, error: validated.error };
    }

    const cleaned = validated.cleaned;
    const event = await getEvent(supabase, cleaned.eventSlug);

    if (!event?.id) {
      return {
        success: false,
        error: { code: "EVENT_NOT_FOUND", message: "Event was not found." },
      };
    }

    if (event.status !== "published" && event.status !== "registration_open") {
      return {
        success: false,
        error: { code: "EVENT_NOT_OPEN", message: "Registration is not open." },
      };
    }

    const identityResolution = await resolveIdentity(supabase, {
      eventId: event.id,
      fullName: cleaned.fullName,
      mobileNumber: cleaned.mobileNumber,
      groupValue: cleaned.groupValue,
    });

    if (
      identityResolution.isDuplicate &&
      identityResolution.matchReasons.includes("mobile_match") &&
      identityResolution.matchedAttendeeId
    ) {
      const existing = await getExistingRegistration(
        supabase,
        identityResolution.matchedAttendeeId
      );

      return {
        ...existing,
        identityResolution,
      };
    }

    const alumniTypeId = await getAttendeeTypeId(supabase, event.id, "alumni");
    const guestTypeId = await getAttendeeTypeId(supabase, event.id, "guest");
    const nextNumber = await nextRegistrationNumber(supabase, event.id);

    const { data: attendee, error: insertError } = await supabase
      .from("event_attendees")
      .insert({
        event_id: event.id,
        attendee_type_id: alumniTypeId,
        full_name: cleaned.fullName,
        mobile_number: cleaned.mobileNumber,
        phone_declined: false,
        group_value: cleaned.groupValue,
        nickname: cleaned.nickname || null,
        registration_source: context.source,
        reg_sequence: nextNumber.regSequence,
        registration_number: nextNumber.registrationNumber,
        created_by: context.registeredBy || null,
      })
      .select("id,full_name,registration_number,qr_token")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    const guestResults: RegisteredGuestResult[] = [];

    for (const guest of cleaned.guests || []) {
      const result = await insertGuest(supabase, {
        eventId: event.id,
        guestTypeId,
        primaryAttendeeId: attendee.id,
        fullName: guest.fullName,
        relationship: guest.relationship,
        source: context.source,
        registeredBy: context.registeredBy,
      });

      guestResults.push(result);
    }

    const pass = buildEventPass({
      registrationNumber: attendee.registration_number,
      qrToken: attendee.qr_token,
    });

    return {
      success: true,
      attendeeId: attendee.id,
      registrationNumber: pass.registrationNumber,
      qrToken: pass.qrToken,
      eventPassUrl: pass.passUrl,
      guests: guestResults,
      identityResolution,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "Registration failed.",
      },
    };
  }
}