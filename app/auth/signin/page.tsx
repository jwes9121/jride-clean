"use client";

import { signInWithGoogle } from "./actions";

export default function SignInPage() {
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
