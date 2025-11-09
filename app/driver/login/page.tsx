"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseDriverClient";

export default function DriverLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      console.error("Driver login error", error);
      setMessage("Login failed. Check your email/password and try again.");
      return;
    }

    if (data.session) {
      setMessage(
        "Login successful. You can now open /driver/livetracking to start sharing your live location."
      );
      // optional redirect:
      window.location.href = "/driver/livetracking";
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100">
      <h1 className="text-xl font-semibold mb-4">JRide Driver Login</h1>
      <p className="text-xs text-slate-400 mb-4 max-w-md text-center">
        Sign in with your assigned JRide driver account. After login, you will
        be redirected to the live tracking page.
      </p>

      <form
        onSubmit={handleLogin}
        className="w-full max-w-xs flex flex-col gap-3"
      >
        <label className="text-xs text-slate-300">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs"
          />
        </label>

        <label className="text-xs text-slate-300">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>

      {message && (
        <p className="mt-4 text-xs text-slate-300 max-w-xs text-center">
          {message}
        </p>
      )}
    </div>
  );
}
