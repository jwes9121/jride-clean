# PATCH-JRIDE_PASSENGER_COOKIE_SESSION_V1.ps1
# Fix passenger login loop by using httpOnly cookies + /api/public/auth/session.
# ASCII-only. Creates backups. Writes UTF-8 (no BOM).

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

function Backup($p){
  if(Test-Path $p){
    $bak = "$p.bak.$(Stamp)"
    Copy-Item $p $bak -Force
    Write-Host "[OK] Backup: $bak"
  }
}

function EnsureDir($p){
  $d = Split-Path -Parent $p
  if(!(Test-Path $d)){ New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

function WriteUtf8NoBom($p, $txt){
  EnsureDir $p
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $txt, $enc)
}

$root = (Get-Location).Path

$loginRoute = Join-Path $root "app\api\public\auth\login\route.ts"
$sessionRoute = Join-Path $root "app\api\public\auth\session\route.ts"
$passengerPage = Join-Path $root "app\passenger\page.tsx"
$passengerLoginPage = Join-Path $root "app\passenger-login\page.tsx"

if(!(Test-Path $loginRoute)){ Fail "Missing file: $loginRoute" }
if(!(Test-Path $passengerPage)){ Fail "Missing file: $passengerPage" }
if(!(Test-Path $passengerLoginPage)){ Fail "Missing file: $passengerLoginPage" }

Backup $loginRoute
Backup $passengerPage
Backup $passengerLoginPage
Backup $sessionRoute

# 1) PATCH login route to SET COOKIES
$loginTxt = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normPhone(raw: string): string {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/[^\d+]/g, "");
  let d = digits;

  if (d.startsWith("09") && d.length === 11) d = "+63" + d.slice(1);
  if (d.startsWith("63") && d.length >= 12) d = "+" + d;
  if (d.startsWith("+63") && d.length >= 13) return d;

  const onlyNums = s.replace(/[^\d]/g, "");
  if (onlyNums.length === 11 && onlyNums.startsWith("09")) return "+63" + onlyNums.slice(1);
  if (onlyNums.length === 10) return "+63" + onlyNums;

  return d;
}

function phoneToInternalEmail(phoneE164: string): string {
  const digits = phoneE164.replace(/[^\d]/g, "");
  return `p_${digits}@phone.jride.local`;
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const phone_raw = String(body?.phone ?? "").trim();
    const password = String(body?.password ?? "").trim();

    if (!phone_raw) return bad("Phone number is required.");
    if (!password) return bad("Password is required.");

    const phone = normPhone(phone_raw);
    if (!/^\+63\d{10}$/.test(phone)) {
      return bad("Phone must be a valid PH number (e.g., 09xxxxxxxxx or +639xxxxxxxxx).");
    }

    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";
    const ANON_KEY =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "";

    if (!SUPABASE_URL || !ANON_KEY) {
      return bad("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.", 500);
    }

    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const email = phoneToInternalEmail(phone);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return bad(error.message || "Login failed.", 401);

    const access_token = data?.session?.access_token || "";
    const refresh_token = data?.session?.refresh_token || "";
    const expires_in = Number(data?.session?.expires_in || 3600);

    if (!access_token || !refresh_token) {
      return bad("Login failed (missing session tokens).", 401);
    }

    const res = NextResponse.json({
      ok: true,
      user_id: data?.user?.id ?? null,
      phone,
      verified: (data?.user?.user_metadata as any)?.verified ?? null,
      night_allowed: (data?.user?.user_metadata as any)?.night_allowed ?? null,
    });

    // IMPORTANT: Set passenger session cookies (httpOnly) so /passenger can recognize login.
    // Use Secure on HTTPS (Vercel prod).
    res.cookies.set({
      name: "jride_pax_at",
      value: access_token,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: expires_in,
    });

    // Refresh token cookie (longer). Adjust maxAge if you want.
    res.cookies.set({
      name: "jride_pax_rt",
      value: refresh_token,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Login failed." },
      { status: 500 }
    );
  }
}
'@
WriteUtf8NoBom $loginRoute $loginTxt
Write-Host "[OK] Patched login route to set cookies: $loginRoute"

# 2) CREATE /api/public/auth/session to VERIFY cookie
$sessionTxt = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const ANON_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!SUPABASE_URL || !ANON_KEY) {
    return NextResponse.json({ ok: false, error: "Missing Supabase env." }, { status: 500 });
  }

  const at = req.cookies.get("jride_pax_at")?.value || "";
  if (!at) {
    return NextResponse.json({ ok: false, authed: false }, { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Validate token
  const { data, error } = await supabase.auth.getUser(at);

  if (error || !data?.user) {
    // Clear bad cookies
    const res = NextResponse.json({ ok: false, authed: false }, { status: 200 });
    res.cookies.set({ name: "jride_pax_at", value: "", path: "/", maxAge: 0 });
    res.cookies.set({ name: "jride_pax_rt", value: "", path: "/", maxAge: 0 });
    return res;
  }

  const md: any = data.user.user_metadata || {};
  const verified = md?.verified === true || ["1","true","yes","y","on"].includes(String(md?.verified ?? "").trim().toLowerCase());
  const night_allowed = md?.night_allowed === true || ["1","true","yes","y","on"].includes(String(md?.night_allowed ?? "").trim().toLowerCase()) || verified;

  return NextResponse.json({
    ok: true,
    authed: true,
    role: "passenger",
    user: {
      id: data.user.id,
      phone: md?.phone ?? null,
      verified,
      night_allowed,
    },
  });
}
'@
WriteUtf8NoBom $sessionRoute $sessionTxt
Write-Host "[OK] Created session route: $sessionRoute"

# 3) PATCH /passenger to use /api/public/auth/session (no NextAuth)
$passengerTxt = @'
"use client";

export const dynamic = "force-dynamic";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function PassengerDashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = React.useState(true);
  const [authed, setAuthed] = React.useState(false);
  const [verified, setVerified] = React.useState(false);
  const [nightAllowed, setNightAllowed] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/public/auth/session", { cache: "no-store" });
        const j: any = await r.json().catch(() => ({}));
        if (!alive) return;
        const ok = !!j?.authed;
        setAuthed(ok);
        setVerified(!!j?.user?.verified);
        setNightAllowed(!!j?.user?.night_allowed);
      } catch {
        if (!alive) return;
        setAuthed(false);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  function gotoLogin() {
    router.push("/passenger-login");
  }

  function goBookRide() {
    if (!authed) return gotoLogin();
    router.push("/ride");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold mb-1">Passenger Dashboard</h1>
            <p className="text-sm opacity-70 mb-5">Choose what you want to do.</p>
          </div>
          <div className="text-xs rounded-full border border-black/10 px-3 py-1">
            <span className="font-semibold">{authed ? "Signed in" : "Guest"}</span>
            <span className="opacity-70">{" - "}{loading ? "loading" : authed ? "session ok" : "no session"}</span>
          </div>
        </div>

        {!authed ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <div className="font-semibold">Sign in required</div>
            <div className="opacity-80">To book a ride, please sign in first.</div>
          </div>
        ) : null}

        {authed && !verified ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
            <div className="font-semibold">Verification may be required (8PM-5AM)</div>
            <div className="opacity-80 text-xs mt-1">
              Verified: {String(verified)} | Night allowed: {String(nightAllowed)}
            </div>
            <div className="opacity-80 text-xs mt-1">
              Next: add Complete Profile / Submit for approval.
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <button
            type="button"
            onClick={goBookRide}
            className="text-left rounded-xl border border-blue-500 bg-blue-500/10 px-4 py-3"
          >
            <div className="font-semibold">Book Ride</div>
            <div className="text-sm opacity-70">Go to ride booking</div>
          </button>

          <button
            type="button"
            onClick={() => (authed ? router.push("/takeout") : gotoLogin())}
            className="text-left rounded-xl border border-black/10 bg-white hover:bg-black/5 px-4 py-3"
          >
            <div className="font-semibold">Takeout</div>
            <div className="text-sm opacity-70">Food delivery (pilot)</div>
          </button>

          <button
            type="button"
            onClick={() => (authed ? router.push("/errand") : gotoLogin())}
            className="text-left rounded-xl border border-black/10 bg-white hover:bg-black/5 px-4 py-3"
          >
            <div className="font-semibold">Errands</div>
            <div className="text-sm opacity-70">Pabili / padala (pilot)</div>
          </button>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => (authed ? router.push("/ride") : gotoLogin())}
            disabled={loading}
            className={
              "rounded-xl px-5 py-2 font-semibold text-white " +
              (loading ? "bg-blue-600/60 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500")
            }
          >
            {loading ? "Loading..." : authed ? "Continue" : "Sign in to continue"}
          </button>

          <button
            type="button"
            onClick={gotoLogin}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
          >
            Switch Account
          </button>
        </div>

        <div className="mt-4 text-xs opacity-70">
          Note: Next step is to connect verification + night rules (8PM-5AM).
        </div>
      </div>
    </main>
  );
}
'@
WriteUtf8NoBom $passengerPage $passengerTxt
Write-Host "[OK] Patched passenger page to use /api/public/auth/session: $passengerPage"

# 4) PATCH passenger-login page to call /api/public/auth/login and redirect to /passenger (no useSearchParams)
$passengerLoginTxt = @'
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
'@
WriteUtf8NoBom $passengerLoginPage $passengerLoginTxt
Write-Host "[OK] Patched passenger-login page: $passengerLoginPage"

Write-Host ""
Write-Host "[NEXT] Run: npm run build"
Write-Host "[NEXT] Deploy to Vercel"
