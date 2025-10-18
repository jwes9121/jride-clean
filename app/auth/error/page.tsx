// app/auth/error/page.tsx
"use client";

import Link from "next/link";

type ErrorKey =
  | "Configuration"
  | "AccessDenied"
  | "OAuthAccountNotLinked"
  | "OAuthCallback"
  | "Callback"
  | "OAuthSignin"
  | "EmailSignin"
  | "CredentialsSignin"
  | "SessionRequired"
  | "default";

const FRIENDLY_MESSAGES: Record<ErrorKey, string> = {
  Configuration: "Auth configuration issue.",
  AccessDenied: "Access denied.",
  OAuthAccountNotLinked:
    "That email is already used by another sign-in method.",
  OAuthCallback: "There was a problem finishing sign-in.",
  Callback: "There was a problem finishing sign-in.",
  OAuthSignin: "There was a problem starting sign-in.",
  EmailSignin: "There was a problem sending the sign-in email.",
  CredentialsSignin: "Invalid credentials.",
  SessionRequired: "Please sign in first.",
  default: "Something went wrong.",
};

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const key = (searchParams.error ?? "default") as ErrorKey;
  const message = FRIENDLY_MESSAGES[key] ?? FRIENDLY_MESSAGES.default;

  return (
    <main className="min-h-[60vh] grid place-items-center p-6">
      <div className="max-w-md w-full rounded-2xl border p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-2">Sign-in error</h1>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex gap-3">
          <Link
            href="/auth/signin"
            className="px-4 py-2 rounded-lg border hover:bg-gray-50"
          >
            Try again
          </Link>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg bg-black text-white hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
