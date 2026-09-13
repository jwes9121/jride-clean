"use client";

export type PassengerSession = {
  ok?: boolean;
  authed?: boolean;
  role?: string | null;
  auth_mode?: string | null;
  access_token?: string | null;
  user?: {
    id?: string;
    email?: string | null;
    phone?: string | null;
    name?: string | null;
    full_name?: string | null;
  } | null;
  expires_at?: number | null;
  error?: string | null;
  message?: string | null;
  status?: number;
};

const TOKEN_KEYS = ["jride_passenger_token", "jride_access_token"] as const;
const DEVICE_KEY = "jride_native_device_id";

function readStorage(storage: Storage, key: string): string {
  try {
    return String(storage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {}
}

function removeStorage(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {}
}

export function getPassengerToken(): string {
  if (typeof window === "undefined") return "";
  try {
    for (const key of TOKEN_KEYS) {
      const local = readStorage(window.localStorage, key);
      if (local) return local;
      const session = readStorage(window.sessionStorage, key);
      if (session) return session;
    }
  } catch {}
  return "";
}

export function getPassengerDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    return (
      readStorage(window.localStorage, DEVICE_KEY) ||
      readStorage(window.sessionStorage, DEVICE_KEY)
    );
  } catch {
    return "";
  }
}

export function passengerAuthHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  const token = getPassengerToken();
  const deviceId = getPassengerDeviceId();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (deviceId) headers["x-device-id"] = deviceId;
  return headers;
}

export function passengerLoginHref(callbackPath = "/passenger"): string {
  const safe =
    callbackPath.startsWith("/") &&
    !callbackPath.startsWith("//") &&
    !callbackPath.includes("\\") &&
    !callbackPath.includes("\n") &&
    !callbackPath.includes("\r")
      ? callbackPath
      : "/passenger";
  return "/passenger-login?callbackUrl=" + encodeURIComponent(safe);
}

export async function preparePassengerSession(): Promise<PassengerSession> {
  if (typeof window === "undefined") return { ok: true, authed: false };
  try {
    const response = await fetch("/api/public/auth/session?include_access_token=1", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const json = (await response.json().catch(() => ({}))) as PassengerSession;
    const session: PassengerSession = { ...json, status: response.status };
    if (response.ok && json?.authed === true && String(json.access_token || "").trim()) {
      const token = String(json.access_token).trim();
      writeStorage(window.localStorage, "jride_passenger_token", token);
      writeStorage(window.localStorage, "jride_access_token", token);
      writeStorage(window.sessionStorage, "jride_passenger_token", token);
      writeStorage(window.sessionStorage, "jride_access_token", token);
    }
    return session;
  } catch (error: any) {
    return {
      ok: false,
      authed: false,
      error: "PASSENGER_SESSION_READ_FAILED",
      message: String(error?.message || "Could not check your passenger session."),
    };
  }
}

export function clearPassengerSessionStorage(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of TOKEN_KEYS) {
      removeStorage(window.localStorage, key);
      removeStorage(window.sessionStorage, key);
    }
  } catch {}
}

export async function signOutPassenger(): Promise<void> {
  try {
    await fetch("/api/public/auth/logout", { method: "POST", cache: "no-store" });
  } catch {}
  clearPassengerSessionStorage();
}
