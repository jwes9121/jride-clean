import type { EventPass } from "./types";

export function buildEventPass(input: {
  registrationNumber: string;
  qrToken: string;
}): EventPass {
  const registrationNumber = String(input.registrationNumber || "").trim();
  const qrToken = String(input.qrToken || "").trim();

  if (!registrationNumber) {
    throw new Error("Registration number is required for event pass.");
  }

  if (!qrToken) {
    throw new Error("QR token is required for event pass.");
  }

  return {
    registrationNumber,
    qrToken,
    passUrl: `/events/pass/${encodeURIComponent(registrationNumber)}`,
  };
}