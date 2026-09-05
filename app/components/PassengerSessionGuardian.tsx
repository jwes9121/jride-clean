"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

const ACCESS_TOKEN_KEYS = ["jride_access_token", "jride_passenger_token"];
const DEVICE_ID_KEY = "jride_native_device_id";

const PROTECTED_PREFIXES = [
  "/passenger",
  "/ride",
  "/takeout",
  "/errands",
  "/agrimarket",
  "/advance-booking",
  "/verification",
];

const AUTH_PREFIXES = [
  "/passenger-login",
  "/passenger-signup",
  "/forgot-password",
  "/reset-password",
];

function isProtectedPassengerPath(pathname: string): boolean {
  if (!pathname) return false;
  if (AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;

  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

function readStorage(key: string): string {
  try {
    return String(window.localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function currentBearerToken(): string {
  return readStorage("jride_access_token") || readStorage("jride_passenger_token");
}

function currentNativeDeviceId(): string {
  return readStorage(DEVICE_ID_KEY);
}

function writeBearerToken(token: string): void {
  const clean = String(token || "").trim();
  if (!clean) return;

  try {
    for (const key of ACCESS_TOKEN_KEYS) {
      window.localStorage.setItem(key, clean);
      window.sessionStorage.setItem(key, clean);
    }
  } catch {}
}

function clearBearerTokens(): void {
  try {
    for (const key of ACCESS_TOKEN_KEYS) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
  } catch {}
}

function callbackUrl(): string {
  try {
    return window.location.pathname + window.location.search + window.location.hash;
  } catch {
    return "/passenger";
  }
}

function authHeadersForSessionProbe(): HeadersInit {
  const deviceId = currentNativeDeviceId();
  const token = currentBearerToken();

  // Browser sessions deliberately use SSR cookies for the authoritative refresh
  // path. Native WebView sessions provide both bearer token and device id.
  if (deviceId && token) {
    return {
      Authorization: `Bearer ${token}`,
      "x-device-id": deviceId,
    };
  }

  return {};
}

function shouldRetryApiRequest(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return false;
    if (!parsed.pathname.startsWith("/api/")) return false;

    const excluded = [
      "/api/public/auth/session",
      "/api/public/auth/login",
      "/api/public/auth/logout",
      "/api/public/auth/refresh",
    ];

    return !excluded.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

type SessionSyncResult = {
  authed: boolean;
  token: string;
  temporaryFailure: boolean;
};

export default function PassengerSessionGuardian() {
  const pathname = usePathname();

  React.useEffect(() => {
    if (!isProtectedPassengerPath(pathname || "")) return;

    let disposed = false;
    let redirecting = false;
    let sessionSyncPromise: Promise<SessionSyncResult> | null = null;
    const originalFetch = window.fetch.bind(window);

    const redirectToLogin = () => {
      if (disposed || redirecting) return;
      redirecting = true;
      clearBearerTokens();

      const target = callbackUrl();
      window.location.replace(
        "/passenger-login?callbackUrl=" + encodeURIComponent(target)
      );
    };

    const doSessionSync = async (): Promise<SessionSyncResult> => {
      const probe = async () => {
        const response = await originalFetch(
          "/api/public/auth/session?include_access_token=1",
          {
            method: "GET",
            headers: authHeadersForSessionProbe(),
            cache: "no-store",
            credentials: "same-origin",
          }
        );

        const json: any = await response.json().catch(() => ({}));
        return { response, json };
      };

      try {
        let { response, json } = await probe();

        // Native WebView can rotate its access token in the Android layer. Give
        // that refresh bridge one short chance to update localStorage before
        // declaring the session dead.
        if (
          (response.status === 401 || json?.authed === false) &&
          currentNativeDeviceId()
        ) {
          const tokenBefore = currentBearerToken();
          await new Promise((resolve) => window.setTimeout(resolve, 1200));

          if (disposed) {
            return { authed: false, token: "", temporaryFailure: true };
          }

          const tokenAfter = currentBearerToken();
          if (tokenAfter && tokenAfter !== tokenBefore) {
            const retried = await probe();
            response = retried.response;
            json = retried.json;
          }
        }

        if (response.status >= 500 || response.status === 429) {
          return {
            authed: false,
            token: currentBearerToken(),
            temporaryFailure: true,
          };
        }

        if (!response.ok || json?.authed !== true) {
          return { authed: false, token: "", temporaryFailure: false };
        }

        const freshToken = String(json?.access_token || "").trim();
        if (freshToken) {
          writeBearerToken(freshToken);
        }

        return {
          authed: true,
          token: freshToken || currentBearerToken(),
          temporaryFailure: false,
        };
      } catch {
        return {
          authed: false,
          token: currentBearerToken(),
          temporaryFailure: true,
        };
      }
    };

    const syncSession = () => {
      if (!sessionSyncPromise) {
        sessionSyncPromise = doSessionSync().finally(() => {
          sessionSyncPromise = null;
        });
      }
      return sessionSyncPromise;
    };

    const checkSession = async () => {
      const result = await syncSession();
      if (disposed) return;

      if (!result.authed && !result.temporaryFailure) {
        redirectToLogin();
      }
    };

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const request = new Request(input, init);
      const retryCopy = request.clone();
      const first = await originalFetch(request);

      if (first.status !== 401 || !shouldRetryApiRequest(request.url)) {
        return first;
      }

      const session = await syncSession();

      if (!session.authed) {
        if (!session.temporaryFailure) {
          redirectToLogin();
        }
        return first;
      }

      if (!session.token) {
        return first;
      }

      const retryHeaders = new Headers(retryCopy.headers);
      retryHeaders.set("Authorization", `Bearer ${session.token}`);

      return originalFetch(
        new Request(retryCopy, {
          headers: retryHeaders,
        })
      );
    };

    window.fetch = wrappedFetch;

    const nativeDelay = currentNativeDeviceId() ? 1400 : 0;
    const initialTimer = window.setTimeout(checkSession, nativeDelay);
    const interval = window.setInterval(checkSession, 60_000);

    const onFocus = () => {
      void checkSession();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkSession();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);

      if (window.fetch === wrappedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, [pathname]);

  return null;
}
