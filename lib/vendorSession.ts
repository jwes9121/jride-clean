import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export const VENDOR_SESSION_COOKIE = "jr_vendor_session";

const VENDOR_SESSION_MAX_AGE_SECONDS =
  Number(process.env.VENDOR_SESSION_MAX_AGE_SECONDS || "") || 8 * 60 * 60;

const LOGIN_ALLOWED_STATUSES = new Set([
  "pilot_lagawe",
  "active",
]);

type VendorSessionPayload = {
  v: string;
  iat: number;
  exp: number;
};

export type AuthenticatedVendor = {
  vendorId: string;
  vendorName: string;
  town: string;
};

export type VendorSessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

export function vendorSessionCookieOptions(): VendorSessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: VENDOR_SESSION_MAX_AGE_SECONDS,
  };
}

export type RequireVendorSessionResult =
  | {
      ok: true;
      vendor: AuthenticatedVendor;
    }
  | {
      ok: false;
      status: number;
      error: "VENDOR_SESSION_INVALID" | "VENDOR_ACCESS_DISABLED";
    };

function getSecret(): string {
  const secret = String(process.env.VENDOR_SESSION_SECRET || "").trim();

  if (!secret) {
    throw new Error("VENDOR_SESSION_SECRET is not set");
  }

  return secret;
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

function createSignature(body: string): string {
  const digest = createHmac("sha256", getSecret()).update(body).digest();
  return encodeBase64Url(digest);
}

function isValidPayload(value: unknown): value is VendorSessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<VendorSessionPayload>;

  return (
    typeof payload.v === "string" &&
    payload.v.trim().length > 0 &&
    typeof payload.iat === "number" &&
    Number.isFinite(payload.iat) &&
    typeof payload.exp === "number" &&
    Number.isFinite(payload.exp)
  );
}

export function signVendorSession(vendorId: string): string {
  const normalizedVendorId = String(vendorId || "").trim();

  if (!normalizedVendorId) {
    throw new Error("vendorId is required");
  }

  const issuedAt = Math.floor(Date.now() / 1000);

  const payload: VendorSessionPayload = {
    v: normalizedVendorId,
    iat: issuedAt,
    exp: issuedAt + VENDOR_SESSION_MAX_AGE_SECONDS,
  };

  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = createSignature(body);

  return `${body}.${signature}`;
}

export function verifyVendorSession(
  token: string | null | undefined
): VendorSessionPayload | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [body, suppliedSignature] = parts;

  if (!body || !suppliedSignature) {
    return null;
  }

  let expectedSignature: string;

  try {
    expectedSignature = createSignature(body);
  } catch {
    return null;
  }

  const suppliedBuffer = Buffer.from(suppliedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(decodeBase64Url(body).toString("utf8"));
  } catch {
    return null;
  }

  if (!isValidPayload(parsedPayload)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (parsedPayload.exp <= now || parsedPayload.iat > now + 60) {
    return null;
  }

  return parsedPayload;
}

async function loadAuthenticatedVendor(
  admin: SupabaseClient,
  vendorId: string
): Promise<AuthenticatedVendor | null> {
  const { data, error } = await admin
    .from("vendor_onboarding_credentials")
    .select("vendor_id,vendor_name,town,status")
    .eq("vendor_id", vendorId)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const status = String(data.status || "").trim().toLowerCase();

  if (!LOGIN_ALLOWED_STATUSES.has(status)) {
    return null;
  }

  const authenticatedVendor: AuthenticatedVendor = {
    vendorId: String(data.vendor_id || "").trim(),
    vendorName: String(data.vendor_name || "").trim(),
    town: String(data.town || "").trim(),
  };

  if (!authenticatedVendor.vendorId) {
    return null;
  }

  return authenticatedVendor;
}

export async function requireVendorSession(
  req: NextRequest,
  admin: SupabaseClient
): Promise<RequireVendorSessionResult> {
  const token = req.cookies.get(VENDOR_SESSION_COOKIE)?.value;
  const payload = verifyVendorSession(token);

  if (!payload) {
    return {
      ok: false,
      status: 401,
      error: "VENDOR_SESSION_INVALID",
    };
  }

  const vendor = await loadAuthenticatedVendor(admin, payload.v);

  if (!vendor) {
    return {
      ok: false,
      status: 401,
      error: "VENDOR_ACCESS_DISABLED",
    };
  }

  return {
    ok: true,
    vendor,
  };
}
