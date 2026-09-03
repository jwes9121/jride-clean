import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_PURPOSE = "vendor-compliance-legacy-ack-v1";
const TOKEN_TTL_SECONDS = 15 * 60;

type LegacyComplianceTokenPayload = {
  purpose: string;
  vendor_id: string;
  sanction_id: string;
  issued_at: number;
  expires_at: number;
};

export type VerifiedLegacyComplianceToken = {
  vendorId: string;
  sanctionId: string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(
    clean(value)
  );
}

function getSecret(): string {
  return clean(
    process.env.VENDOR_COMPLIANCE_LEGACY_SECRET ||
      process.env.VENDOR_SESSION_SECRET
  );
}

function encodeBase64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(paddingLength), "base64");
}

function signature(body: string, secret: string): string {
  return encodeBase64Url(createHmac("sha256", secret).update(body).digest());
}

export function signLegacyComplianceAcknowledgementToken(
  vendorIdValue: unknown,
  sanctionIdValue: unknown
): string | null {
  const secret = getSecret();
  const vendorId = clean(vendorIdValue);
  const sanctionId = clean(sanctionIdValue);

  if (!secret || !isUuid(vendorId) || !isUuid(sanctionId)) {
    return null;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: LegacyComplianceTokenPayload = {
    purpose: TOKEN_PURPOSE,
    vendor_id: vendorId,
    sanction_id: sanctionId,
    issued_at: issuedAt,
    expires_at: issuedAt + TOKEN_TTL_SECONDS,
  };

  const body = encodeBase64Url(JSON.stringify(payload));
  return `${body}.${signature(body, secret)}`;
}

export function verifyLegacyComplianceAcknowledgementToken(
  tokenValue: unknown
): VerifiedLegacyComplianceToken | null {
  const secret = getSecret();
  const token = clean(tokenValue);
  if (!secret || !token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, suppliedSignature] = parts;
  if (!body || !suppliedSignature) return null;

  const expectedSignature = signature(body, secret);
  const suppliedBuffer = Buffer.from(suppliedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload: LegacyComplianceTokenPayload;
  try {
    payload = JSON.parse(
      decodeBase64Url(body).toString("utf8")
    ) as LegacyComplianceTokenPayload;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    payload?.purpose !== TOKEN_PURPOSE ||
    !isUuid(payload?.vendor_id) ||
    !isUuid(payload?.sanction_id) ||
    !Number.isFinite(payload?.issued_at) ||
    !Number.isFinite(payload?.expires_at) ||
    payload.issued_at > now + 60 ||
    payload.expires_at <= now ||
    payload.expires_at > payload.issued_at + TOKEN_TTL_SECONDS
  ) {
    return null;
  }

  return {
    vendorId: clean(payload.vendor_id),
    sanctionId: clean(payload.sanction_id),
  };
}
