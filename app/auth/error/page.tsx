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
    <div className="mx-auto max-w-md p-6 text-center">
      <h1 className="mb-2 text-2xl font-semibold">Sign-in error</h1>
      <p className="mb-6 text-sm text-neutral-600">{message}</p>
      <div className="flex items-center justify-center gap-3">
        <Link
          href="/auth/signin"
          className="rounded-md border px-3 py-2 text-sm"
        >
          Try again
        </Link>
        <Link
          href="/"
          className="rounded-md bg-black px-3 py-2 text-sm text-white"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
