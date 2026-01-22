# FIX-JRIDE_PASSENGER_LOGIN_PAGE_NEXTAUTH_CREDENTIALS_V5.ps1
# Hard resets app/passenger-login/page.tsx to a known-good NextAuth signIn("credentials") flow.
# Uses ?next=... to redirect after login. Backup + UTF-8 no BOM.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Backup($p){
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts"
}

$root = (Get-Location).Path
$f = Join-Path $root "app\passenger-login\page.tsx"
if (!(Test-Path $f)) { Fail "Missing file: $f" }

Backup $f

$clean = @'
"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export const dynamic = "force-static";

export default function PassengerLoginPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    const next = sp?.get("next") || "/passenger";

    try {
      const r: any = await signIn("credentials", {
        phone,
        password,
        redirect: false,
        callbackUrl: next,
      });

      if (r?.error) {
        setMsg("Login failed. Please check phone/password.");
        return;
      }

      const url = String(r?.url || next);
      router.push(url);
    } catch (err: any) {
      setMsg(err?.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur">
        <h1 className="text-2xl font-semibold mb-1">Passenger Login</h1>
        <p className="text-sm opacity-80 mb-6">Sign in with your phone number.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm opacity-80">Phone (PH)</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XXXXXXXXX or +639XXXXXXXXX"
              required
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Password</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              type="password"
              required
            />
          </div>

          {msg && (
            <div className="text-sm rounded-xl px-3 py-2 bg-white/10 border border-white/10">
              {msg}
            </div>
          )}

          <button
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-2 font-semibold"
            type="submit"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div className="text-sm opacity-80 text-center">
            Don&apos;t have an account yet?{" "}
            <a className="text-blue-300 underline" href="/passenger-signup">
              Register here
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}
'@

$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $clean, $enc)

Write-Host "[OK] Passenger login now uses signIn('credentials') + next= redirect."
