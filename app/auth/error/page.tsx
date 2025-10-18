// app/auth/error/page.tsx
"use client";
<<<<<<< HEAD

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Render the part that uses the hook inside Suspense
function ErrorInner() {
  const params = useSearchParams();
  const code = params.get("error") ?? "unknown";

  const friendly =
    {
      Configuration: "Auth config issue.",
      AccessDenied: "Access denied.",
      OAuthAccountNotLinked:
        "This Google account is not linked to your email. Try a different sign-in option.",
      OAuthCallback: "OAuth callback failed.",
      Callback: "Sign-in callback failed.",
      OAuthSignin: "OAuth sign-in failed.",
      EmailSignin: "Email sign-in failed.",
      CredentialsSignin: "Credentials sign-in failed.",
      SessionRequired: "Please sign in.",
      default: "Something went wrong.",
    }[code as keyof any] ?? "Something went wrong.";

  return (
    <main className="min-h-[60vh] grid place-items-center p-6">
      <div className="max-w-md w-full rounded-lg border p-6">
        <h1 className="text-xl font-semibold mb-2">Sign-in error</h1>
        <p className="text-sm text-gray-600">
          <span className="font-medium">{friendly}</span>
          {code !== "unknown" && (
            <>
              {" "}
              <span className="text-gray-500">(code: {code})</span>
            </>
          )}
        </p>

        <div className="mt-6 flex gap-3">
          <Link
            href="/auth/signin"
            className="rounded-md px-3 py-2 border bg-white hover:bg-gray-50"
          >
            Try again
          </Link>
          <Link
            href="/"
            className="rounded-md px-3 py-2 bg-black text-white hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
=======

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
>>>>>>> 123ce936f26558d32b3c16b44971d53d70cd9e43
  );
}

// Wrap hook usage in Suspense
export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <ErrorInner />
    </Suspense>
  );
}

// Prevent static prerender/export issues
export const dynamic = "force-dynamic";
