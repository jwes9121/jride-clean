import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const FARMER_SESSION_COOKIE = "__Secure-jride_agri_farmer_v1";
export const FARMER_SESSION_PATH = "/api/agrimarket/producer";
export const FARMER_SESSION_SECONDS = 30 * 24 * 60 * 60;
export function newFarmerSessionToken() { return randomBytes(32).toString("hex"); }
export function farmerSessionHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function farmerSessionToken(req: NextRequest) {
  const value = req.cookies.get(FARMER_SESSION_COOKIE)?.value || "";
  return /^[a-f0-9]{64}$/.test(value) ? value : "";
}
export function farmerSessionRequestAllowed(req: NextRequest) {
  const origin = req.headers.get("origin");
  return req.headers.get("x-jride-agrimarket-session") === "1"
    && req.headers.get("sec-fetch-site") !== "cross-site"
    && (!origin || origin === req.nextUrl.origin)
    && (["GET", "HEAD"].includes(req.method) || origin === req.nextUrl.origin);
}
export function setFarmerSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(FARMER_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict",
    path: FARMER_SESSION_PATH, maxAge: token ? FARMER_SESSION_SECONDS : 0 });
  return response;
}
export async function readFarmerSession(req: NextRequest, db: { rpc: Function }) {
  const token = farmerSessionToken(req);
  if (!token || !farmerSessionRequestAllowed(req)) return null;
  const result = await db.rpc("agrimarket_farmer_session_read_v1", { p_token_hash: farmerSessionHash(token) });
  if (result.error) throw new Error("FARMER_SESSION_UNAVAILABLE");
  const session = result.data;
  const requestedCode = (req.headers.get("x-jride-agrimarket-code") || "").trim().toUpperCase();
  // A tab belonging to another farm must not act using a changed browser cookie.
  if (requestedCode && requestedCode !== session?.access_code) return null;
  return session?.producer?.id ? session : null;
}
