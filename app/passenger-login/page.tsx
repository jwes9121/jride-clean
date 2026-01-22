"use client";

export const dynamic = "force-static";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function PassengerLoginPage() {
  const router = useRouter();

  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/public/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setMsg(j?.error || "Login failed.");
        return;
      }
      setMsg("Login OK. Redirecting...");
      setTimeout(() => router.push("/passenger"), 250);
    } catch (err: any) {
      setMsg(err?.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-1">Passenger Login</h1>
        <p className="text-sm opacity-70 mb-6">Sign in with your phone number.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm opacity-80">Phone (PH)</label>
            <input
              className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 outline-none"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XXXXXXXXX or +639XXXXXXXXX"
              required
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Password</label>
            <input
              className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              type="password"
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
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-2 font-semibold text-white"
            type="submit"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div className="text-sm opacity-80 text-center">
            Don't have an account yet?{" "}
            <a className="text-blue-600 underline" href="/passenger-signup">
              Register here
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}