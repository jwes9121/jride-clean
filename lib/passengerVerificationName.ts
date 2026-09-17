export const PASSENGER_VERIFICATION_NAME_GUIDANCE =
  "Enter your full name exactly as shown on your valid ID. First name and last name are required and must each contain at least 2 letters. Middle initials are allowed.";

export type PassengerVerificationNameValidation = {
  valid: boolean;
  normalized: string;
  error: string | null;
};

function countLetters(value: string): number {
  return Array.from(value).filter((ch) => /\p{L}/u.test(ch)).length;
}

function hasOnlyNameCharacters(value: string): boolean {
  return /^[\p{L} .'-]+$/u.test(value);
}

export function normalizePassengerVerificationName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function validatePassengerVerificationName(
  value: unknown
): PassengerVerificationNameValidation {
  const normalized = normalizePassengerVerificationName(value);

  if (!normalized) {
    return { valid: false, normalized, error: "Full name is required." };
  }

  if (!hasOnlyNameCharacters(normalized)) {
    return {
      valid: false,
      normalized,
      error: "Name may contain letters, spaces, periods, apostrophes, and hyphens only.",
    };
  }

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length < 2) {
    return {
      valid: false,
      normalized,
      error:
        "Enter both first name and last name. Single-name verification submissions are not accepted.",
    };
  }

  const firstLetters = countLetters(parts[0]);
  const lastLetters = countLetters(parts[parts.length - 1]);

  if (firstLetters < 2 || lastLetters < 2) {
    return {
      valid: false,
      normalized,
      error:
        "First name and last name must each contain at least 2 letters. Middle initials are allowed, but first-name or last-name initials are not accepted.",
    };
  }

  return { valid: true, normalized, error: null };
}
