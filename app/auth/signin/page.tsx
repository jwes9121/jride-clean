"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle } from "./actions";

// we'll read the cookie client-side to guess if you're signed in
// we don't need full session details here, just "do you have a session cookie?"
function hasSessionCookie() {
  // any cookie starting with `_Secure-` from NextAuth means you're logged in
  // we'll just check document.cookie for "next-auth" patterns
  if (typeof document === "undefined") return false;
  return document.cookie.includes("next-auth.session-token")
    || document.cookie.includes("__Secure-next-auth.session-token")
    || document.cookie.includes("_Secure-"); // fallback: what we saw in prod
}

export default function SignInPage() {
  const router = useRouter();

  // if already signed in -> bounce to /dispatch immediately
  useEffect(() => {
    if (hasSessionCookie()) {
      router.replace("/dispatch");
    }
  }, [router]);

  return (
    <main className="p-6 max-w-sm mx-auto text-center">
      <h1 className="text-lg font-semibold mb-4">Sign in</h1>

      <form action={signInWithGoogle}>
        <button
          className="border rounded px-4 py-2 text-sm font-medium w-full"
          type="submit"
        >
          Continue with Google
        </button>
      </form>

      <p className="text-xs text-gray-500 mt-4">
        You’ll be redirected to Google, then back here.
      </p>
    </main>
  );
}
