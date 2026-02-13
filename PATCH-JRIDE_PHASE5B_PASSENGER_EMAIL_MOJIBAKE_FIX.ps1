$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

if (!(Test-Path ".\package.json")) { Fail "Run this from your Next.js repo root (where package.json exists)." }
if (!(Test-Path ".\app")) { Fail "Expected ./app folder (Next.js App Router). Aborting." }

$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")

$apiSignup = "app\api\public\auth\signup\route.ts"
$pgLogin   = "app\passenger-login\page.tsx"
$pgSignup  = "app\passenger-signup\page.tsx"

function BackupIfExists($path){
  if (Test-Path $path) {
    $bak = "$path.bak.$ts"
    Copy-Item $path $bak -Force
    Ok "[OK] Backup: $bak"
  }
}

BackupIfExists $apiSignup
BackupIfExists $pgLogin
BackupIfExists $pgSignup

# Ensure dirs
New-Item -ItemType Directory -Force -Path (Split-Path $apiSignup) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $pgLogin)   | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $pgSignup)  | Out-Null

# 1) Update signup API: accept optional contact_email and store in metadata
$signupSrc = @'
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

function isEmail(s: string): boolean {
  const v = String(s || "").trim();
  if (!v) return false;
  // simple safe check (pilot)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const full_name = String(body?.full_name ?? "").trim();
    const phone_raw = String(body?.phone ?? "").trim();
    const password = String(body?.password ?? "").trim();
    const role = String(body?.role ?? "passenger").trim() || "passenger";
    const address = String(body?.address ?? "").trim();
    const town = String(body?.town ?? "").trim();

    const contact_email_raw = String(body?.contact_email ?? "").trim();
    const contact_email = isEmail(contact_email_raw) ? contact_email_raw : "";

    if (!full_name) return bad("Full name is required.");
    if (!phone_raw) return bad("Phone number is required.");
    if (!password || password.length < 6) return bad("Password must be at least 6 characters.");

    const phone = normPhone(phone_raw);
    if (!/^\+63\d{10}$/.test(phone)) {
      return bad("Phone must be a valid PH number (e.g., 09xxxxxxxxx or +639xxxxxxxxx).");
    }

    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";
    const SERVICE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return bad("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on server.", 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // IMPORTANT:
    // We keep a stable internal email for password-auth using phone.
    // contact_email is stored as metadata only (pilot).
    const email = phoneToInternalEmail(phone);

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role,
        full_name,
        phone,
        address,
        town,
        contact_email: contact_email || null,
        signup_source: "web",
      },
    });

    if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
        return bad("This phone is already registered. Please login instead.", 409);
      }
      return bad(msg || "Signup failed.", 500);
    }

    return NextResponse.json({
      ok: true,
      user_id: data?.user?.id ?? null,
      phone,
      role,
      contact_email: contact_email || null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Signup failed." },
      { status: 500 }
    );
  }
}
'@
Set-Content -LiteralPath $apiSignup -Value $signupSrc -Encoding UTF8
Ok "[OK] Wrote: $apiSignup"

# 2) Update passenger signup page: add Email field
$passengerSignupSrc = @'
"use client";
import * as React from "react";
export const dynamic = "force-static";

export default function PassengerSignupPage() {
  const [fullName, setFullName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [town, setTown] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/public/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "passenger",
          full_name: fullName,
          phone,
          contact_email: contactEmail,
          address,
          town,
          password,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) return setMsg(j?.error || "Signup failed.");
      setMsg("✅ Signup successful! Redirecting to login...");
      setTimeout(() => (window.location.href = "/passenger-login"), 800);
    } catch (err: any) {
      setMsg(err?.message || "Signup failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur">
        <h1 className="text-2xl font-semibold mb-1">Passenger Signup</h1>
        <p className="text-sm opacity-80 mb-6">Create your JRide passenger account.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm opacity-80">Full name</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Juan Dela Cruz"
              required
            />
          </div>

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
            <label className="text-sm opacity-80">Email (optional)</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="you@email.com"
              type="email"
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Address (optional)</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Barangay / Street"
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Town (optional)</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={town}
              onChange={(e) => setTown(e.target.value)}
              placeholder="Lagawe / Kiangan / Banaue..."
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Password</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
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
            {loading ? "Creating..." : "Create account"}
          </button>

          <div className="text-sm opacity-80 text-center">
            Already have an account?{" "}
            <a className="text-blue-300 underline" href="/passenger-login">
              Login
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}
'@
Set-Content -LiteralPath $pgSignup -Value $passengerSignupSrc -Encoding UTF8
Ok "[OK] Wrote: $pgSignup"

# 3) Fix mojibake on login page: use ASCII apostrophe (Don't)
$passengerLoginFixed = @'
"use client";
import * as React from "react";
export const dynamic = "force-static";

export default function PassengerLoginPage() {
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
      if (!res.ok || !j?.ok) return setMsg(j?.error || "Login failed.");
      setMsg("✅ Login OK. (Pilot) Next: redirect to your booking page/dashboard.");
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
            Don't have an account yet?{" "}
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
Set-Content -LiteralPath $pgLogin -Value $passengerLoginFixed -Encoding UTF8
Ok "[OK] Wrote: $pgLogin"

Ok "`n[DONE] Phase 5B: passenger signup email field + login mojibake fix."
Info "`nNEXT STEPS:"
Info "1) npm.cmd run build"
Info "2) git add -A"
Info "3) git commit -m `"JRIDE_PHASE5B passenger signup email + mojibake fix`""
Info "4) git tag JRIDE_PHASE5B_PASSENGER_EMAIL_$ts"
Info "5) git push && git push --tags"
