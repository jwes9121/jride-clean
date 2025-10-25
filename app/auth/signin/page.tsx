"use client";

import { signIn } from "../../../auth";

export default function SignInPage() {
  return (
    <main className="p-6 max-w-sm mx-auto text-center">
      <h1 className="text-lg font-semibold mb-4">Sign in</h1>
      <form
        action={async () => {
          "use server";
          await signIn("google"); // provider id is "google"
        }}
      >
        <button
          className="border rounded px-4 py-2 text-sm font-medium w-full"
          type="submit"
        >
          Continue with Google
        </button>
      </form>
    </main>
  );
}
