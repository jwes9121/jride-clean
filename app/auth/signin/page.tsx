"use client";

import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  const searchParams = useSearchParams();

  // Grab ?callbackUrl=... from the URL.
  // If it's missing, default to "/".
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  async function handleGoogle() {
    // Pass callbackUrl so we return to /admin/livetrips (or whatever asked for auth)
    await signIn("google", {
      callbackUrl,
    });
  }

  return (
    <div
      style={{
        maxWidth: "320px",
        margin: "80px auto",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Sign in</h1>

      <p style={{ fontSize: ".9rem", color: "#666" }}>
        Use your Google account to continue.
      </p>

      <button
        onClick={handleGoogle}
        style={{
          padding: "10px 16px",
          borderRadius: "6px",
          border: "1px solid #ccc",
          fontSize: ".95rem",
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        Continue with Google
      </button>
    </div>
  );
}
