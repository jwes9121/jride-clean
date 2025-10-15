"use client";

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
