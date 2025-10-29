"use client";

import { signIn } from "@/auth";

export default function GoogleSignInButton() {
  return (
    <button
      className="rounded bg-black text-white px-4 py-2"
      onClick={() => signIn("google", { redirectTo: "/dispatch" })}
    >
      Continue with Google
    </button>
  );
}
