// app/auth/signin/page.tsx
"use client";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <div className="p-6">
      <button
        onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
        className="border rounded-lg px-4 py-2"
      >
        Sign in with Google
      </button>
    </div>
  );
}
