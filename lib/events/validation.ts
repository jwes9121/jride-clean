import type { EventRegistrationRequest, GuestInput, RegistrationError } from "./types";

function cleanText(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function cleanPhone(value: unknown): string {
  return String(value || "").trim().replace(/[^\d+]/g, "");
}

function validateGuest(guest: GuestInput, index: number): RegistrationError | null {
  const fullName = cleanText(guest.fullName);
  const relationship = cleanText(guest.relationship);

  if (fullName.length < 2) {
    return { code: "INVALID_GUEST", message: `Guest ${index + 1} name is required.` };
  }

  if (relationship.length < 2) {
    return { code: "INVALID_GUEST", message: `Guest ${index + 1} relationship is required.` };
  }

  return null;
}

export function validateRegistration(request: EventRegistrationRequest): {
  ok: boolean;
  cleaned?: EventRegistrationRequest;
  error?: RegistrationError;
} {
  const eventSlug = cleanText(request.eventSlug);
  const fullName = cleanText(request.fullName);
  const mobileNumber = cleanPhone(request.mobileNumber);
  const groupValue = cleanText(request.groupValue);
  const nickname = cleanText(request.nickname);
  const guests = Array.isArray(request.guests) ? request.guests : [];

  if (!eventSlug) {
    return { ok: false, error: { code: "EVENT_NOT_FOUND", message: "Event is required." } };
  }

  if (fullName.length < 2) {
    return { ok: false, error: { code: "INVALID_NAME", message: "Full name is required." } };
  }

  if (mobileNumber.length < 10) {
    return { ok: false, error: { code: "INVALID_MOBILE_NUMBER", message: "Valid mobile number is required." } };
  }

  if (!groupValue) {
    return { ok: false, error: { code: "INVALID_GROUP_VALUE", message: "Batch is required." } };
  }

  for (let i = 0; i < guests.length; i++) {
    const guestError = validateGuest(guests[i], i);
    if (guestError) {
      return { ok: false, error: guestError };
    }
  }

  return {
    ok: true,
    cleaned: {
      eventSlug,
      fullName,
      mobileNumber,
      groupValue,
      nickname: nickname || undefined,
      guests: guests.map((guest) => ({
        fullName: cleanText(guest.fullName),
        relationship: cleanText(guest.relationship),
        hasOwnQr: guest.hasOwnQr !== false,
      })),
    },
  };
}