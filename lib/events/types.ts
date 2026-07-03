export type RegistrationSource = "online" | "jride_login" | "assisted" | "walk_in";

export type AttendeeStatus = "registered" | "checked_in" | "disqualified";

export type RegistrationErrorCode =
  | "EVENT_NOT_FOUND"
  | "EVENT_NOT_OPEN"
  | "INVALID_NAME"
  | "INVALID_MOBILE_NUMBER"
  | "INVALID_GROUP_VALUE"
  | "INVALID_GUEST"
  | "DUPLICATE_MOBILE"
  | "SERVER_ERROR";

export type IdentityConfidence = "high" | "medium" | "low";

export interface GuestInput {
  fullName: string;
  relationship: string;
  hasOwnQr?: boolean;
}

export interface EventRegistrationRequest {
  eventSlug: string;
  fullName: string;
  mobileNumber: string;
  groupValue: string;
  nickname?: string;
  guests?: GuestInput[];
}

export interface RegistrationContext {
  source: RegistrationSource;
  registeredBy?: string;
}

export interface RegistrationError {
  code: RegistrationErrorCode;
  message: string;
}

export interface EventPass {
  registrationNumber: string;
  qrToken: string;
  passUrl: string;
}

export interface IdentityResolution {
  isDuplicate: boolean;
  confidence: IdentityConfidence;
  matchedAttendeeId?: string;
  registrationNumber?: string | null;
  matchReasons: string[];
  requiresReview: boolean;
}

export interface RegisteredGuestResult {
  attendeeId: string;
  registrationNumber: string;
  qrToken: string;
  passUrl: string;
  fullName: string;
  relationship: string;
}

export interface RegistrationResult {
  success: boolean;
  attendeeId?: string;
  registrationNumber?: string;
  qrToken?: string;
  eventPassUrl?: string;
  guests?: RegisteredGuestResult[];
  identityResolution?: IdentityResolution;
  error?: RegistrationError;
}