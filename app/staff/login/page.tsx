"use client";

import React, { useState } from "react";
import { signIn } from "next-auth/react";

export default function StaffLoginPage() {
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");

  async function handleGoogleSignIn() {
    try {
      setBusy(true);
      setErrorText("");
      await signIn("google", {
        callbackUrl: "/admin/livetrips",
      });
    } catch (error) {
      console.error("[staff/login] Google sign-in failed", error);
      setErrorText("Google sign-in failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6 py-12">
        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl">
          <div className="mb-6">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
              JRide Staff Access
            </div>
            <h1 className="mt-2 text-2xl font-bold text-white">
              Admin and Dispatcher Login
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Use your approved Google account to access staff tools.
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-sm font-semibold text-white">
              Allowed roles
            </div>
            <div className="text-sm text-slate-300">
              Admin and Dispatcher only
            </div>
          </div>

          {errorText ? (
            <div className="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {errorText}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className={[
              "mt-6 flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition",
              busy
                ? "cursor-not-allowed bg-slate-700 text-slate-300"
                : "bg-emerald-500 text-slate-950 hover:bg-emerald-400",
            ].join(" ")}
          >
            {busy ? "Signing in..." : "Continue with Google"}
          </button>

          <div className="mt-4 text-xs leading-5 text-slate-400">
            This page is for staff monitoring only. Passenger login does not belong here.
          </div>
        </div>
      </div>
    </main>
  );
}
