// app/auth/signin/page.tsx
"use client";

import { signIn } from "next-auth/react";

export default function SignIn() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <button
        onClick={() => signIn("google", { callbackUrl: "/" })}
        className="rounded px-4 py-2 bg-black text-white"
      >
        Continue with Google
      </button>
    </main>
  );
}
