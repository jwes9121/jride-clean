// app/auth/signin/page.tsx
"use client";
import { signIn, useSession } from "next-auth/react";

export default function SignInPage() {
  const { data: session } = useSession();

  if (session) {
    return (
      <div className="p-6">
        <p>You are already signed in as {session.user?.email}</p>
        <a href="/dashboard" className="underline text-blue-600">
          Go to Dashboard
        </a>
      </div>
    );
  }

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
