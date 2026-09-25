"use client";

import * as React from "react";

export const dynamic = "force-static";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function ForgotPasswordPage() {
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!phone.trim()) {
      setMsg("Enter the mobile number used to sign in.");
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      setMsg("Enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/public/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), email: normalizedEmail }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setMsg(j?.error || "Unable to send reset link.");
        return;
      }

      setMsg(j?.message || "If these details match an account, a reset link will be emailed. Finish the reset before signing in.");
    } catch (err: any) {
      setMsg(err?.message || "Unable to send reset link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-1">Forgot Password</h1>
        <p className="text-sm opacity-70 mb-6">
          Enter the mobile number you use to sign in and the email linked to that same account. Resetting a different account will not change this number’s password.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="recovery-phone" className="text-sm opacity-80">Registered mobile number</label>
            <input
              id="recovery-phone"
              className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 outline-none"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XXXXXXXXX or +639XXXXXXXXX"
              type="tel"
              autoComplete="tel"
              required
            />
          </div>
          <div>
            <label htmlFor="recovery-email" className="text-sm opacity-80">Linked email address</label>
            <input
              className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 outline-none"
              id="recovery-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </div>

          {msg ? (
            <div className="text-sm rounded-xl px-3 py-2 border border-black/10 bg-black/5">
              {msg}
            </div>
          ) : null}

          <button
            disabled={loading}
            type="submit"
            className={
              "w-full rounded-xl px-4 py-2 font-semibold text-white " +
              (loading
                ? "bg-blue-600/60 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-500")
            }
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <p className="mt-4 text-sm opacity-70">If you cannot access the email linked to this mobile number, contact JRide support.</p>

        <div className="mt-4 text-center text-sm opacity-70">
          Remember your password?{" "}
          <a href="/passenger-login" className="underline">
            Back to login
          </a>
        </div>
      </div>
    </main>
  );
}
