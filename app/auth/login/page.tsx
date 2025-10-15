"use client";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <div className="p-6">
      <button className="border rounded px-3 py-2" onClick={() => signIn("google")}>
        Continue with Google
      </button>
    </div>
  );
}
