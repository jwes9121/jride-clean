// app/auth/signin/page.tsx
"use client";

import { signIn } from "next-auth/react";

export default function SignIn() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Sign in</h1>
      <p>Use your Google account to continue.</p>
      <button
        onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #ddd",
          background: "#f5f5ff",
          cursor: "pointer",
          marginTop: 12,
        }}
      >
        Continue with Google
      </button>
    </main>
  );
}
