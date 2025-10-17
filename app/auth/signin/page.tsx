// app/auth/signin/page.tsx
"use client";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm rounded-2xl border p-6 space-y-3">
        <h1 className="text-xl font-semibold">Sign in</h1>

        <button
          className="w-full rounded-xl border px-4 py-2"
          onClick={() => signIn("google", { callbackUrl: "/" })}
        >
          Continue with Google
        </button>

        {/* Dev-only creds fallback */}
        {process.env.NODE_ENV !== "production" && (
          <button
            className="w-full rounded-xl border px-4 py-2"
            onClick={() => signIn("credentials", { email: "dev@example.com", callbackUrl: "/" })}
          >
            Dev login
          </button>
        )}
      </div>
    </div>
  );
}
