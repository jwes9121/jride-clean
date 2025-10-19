"use client";
import { signIn } from "next-auth/react";

export default function SignIn() {
  return (
    <button
      onClick={() => signIn("google", { callbackUrl: "/dispatch" })} // <- change target
      className="px-4 py-2 rounded bg-black text-white"
    >
      Continue with Google
    </button>
  );
}
