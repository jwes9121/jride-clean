"use client";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <div className="p-6">
      <button
        onClick={() => signIn("google", { callbackUrl: "/" })}
        className="rounded px-4 py-2 border"
      >
        Continue with Google
      </button>
      <p className="text-sm mt-2">Youâ€™ll be redirected to your dashboard.</p>
    </div>
  );
}


