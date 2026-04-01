"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = useMemo(() => params.get("token") || "", [params]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setMsg("");

    if (!token) {
      setMsg("Missing reset token.");
      return;
    }

    if (!password || password.length < 6) {
      setMsg("Password must be at least 6 characters.");
      return;
    }

    if (password != confirmPassword) {
      setMsg("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/public/auth/reset_password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          new_password: password,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setMsg(j?.error || "Reset failed.");
        return;
      }

      setDone(true);
      setMsg("Password has been reset successfully. You can now sign in.");
    } catch (e: any) {
      setMsg(e?.message || "Reset failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <h1>Reset Password</h1>
      <p>Enter your new password below.</p>

      <div style={{ display: "grid", gap: 12 }}>
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading || done}
          style={{ padding: 12 }}
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={loading || done}
          style={{ padding: 12 }}
        />
        <button
          onClick={submit}
          disabled={loading || done}
          style={{ padding: 12, cursor: "pointer" }}
        >
          {loading ? "Updating..." : "Reset Password"}
        </button>
      </div>

      {msg ? <p style={{ marginTop: 16 }}>{msg}</p> : null}
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}><p>Loading...</p></main>}>
      <ResetPasswordForm />
    </Suspense>
  );
}