# PATCH-JRIDE_PASSENGER_NEXTAUTH_CREDENTIALS_V1.ps1 (V1b)
# Adds NextAuth Credentials provider (Passenger phone/password) while keeping Google provider (admin/dispatcher).
# Safe, anchored edits + backups. Writes UTF-8 (no BOM).

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

function Backup-File($p) {
  if (!(Test-Path $p)) { Fail "Missing file: $p" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak.$ts"
  Copy-Item $p $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Read-Utf8NoBom($p) {
  $enc = [System.Text.UTF8Encoding]::new($false)
  return [System.IO.File]::ReadAllText($p, $enc)
}

function Write-Utf8NoBom($p, $txt) {
  $enc = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($p, $txt, $enc)
}

$root = (Get-Location).Path
$authPath = Join-Path $root "auth.ts"
if (!(Test-Path $authPath)) { Fail "auth.ts not found at repo root. Current: $root" }

Backup-File $authPath
$txt = Read-Utf8NoBom $authPath

# Strip BOM if present
if ($txt.Length -gt 0 -and [int][char]$txt[0] -eq 0xFEFF) {
  $txt = $txt.Substring(1)
}

# 1) Ensure Credentials import (use regex replace to avoid PS -replace parsing issues)
if ($txt -notmatch 'next-auth/providers/credentials') {
  $googleLine = 'import Google from "next-auth/providers/google";'
  if ($txt -match [regex]::Escape($googleLine)) {
    $replacement = $googleLine + "`n" + 'import Credentials from "next-auth/providers/credentials";'
    $txt = [regex]::Replace($txt, [regex]::Escape($googleLine), [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement }, 1)
    Write-Host "[OK] Injected Credentials provider import."
  } else {
    Fail "Could not find Google import line to anchor Credentials import."
  }
} else {
  Write-Host "[SKIP] Credentials import already present."
}

# 2) Inject Credentials provider into providers array (before Google)
if ($txt -notmatch 'Credentials\(\{[\s\S]*?authorize') {

  if ($txt -notmatch 'providers:\s*\[') { Fail "Could not find providers: [ in auth.ts" }

  $credentialsBlock = @'
    Credentials({
      id: "passenger-credentials",
      name: "Passenger Login",
      credentials: {
        phone: { label: "Phone", type: "text", placeholder: "09XXXXXXXXX or +639XXXXXXXXX" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const phone = String((credentials as any)?.phone || "").trim();
        const password = String((credentials as any)?.password || "").trim();
        if (!phone || !password) return null;

        // Reuse your existing passenger login endpoint to avoid guessing DB schema.
        const baseUrl =
          process.env.NEXTAUTH_URL ||
          process.env.AUTH_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

        const res = await fetch(`${baseUrl}/api/public/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "passenger", phone, password }),
        });

        const j: any = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) return null;

        // Flexible mapping
        const u = j?.user || j?.data?.user || j?.profile || j?.passenger || j;
        const id = String(u?.id || u?.user_id || u?.passenger_id || u?.uid || phone);
        const name = String(u?.full_name || u?.name || u?.display_name || phone);
        const email = u?.contact_email || u?.email || undefined;

        return { id, name, email, phone, role: "passenger" } as any;
      },
    }),
'@

  # Anchor insert before the first Google({
  if ($txt -match 'providers:\s*\[[\s\S]*?\n\s*Google\(\{') {
    $txt = [regex]::Replace(
      $txt,
      '(\n\s*)Google\(\{',
      "`n$credentialsBlock`$1Google({",
      1
    )
    Write-Host "[OK] Injected Credentials provider before Google."
  } else {
    Fail "Could not find Google({ inside providers array to anchor insertion."
  }

} else {
  Write-Host "[SKIP] Credentials provider already present."
}

# 3) Patch jwt callback
$jwtRegex = [regex]'async\s+jwt\s*\(\s*\{\s*token\s*\}\s*\)\s*\{\s*[\s\S]*?\n\s*\},'
if ($jwtRegex.IsMatch($txt)) {
  $newJwt = @'
    async jwt({ token, user, account }) {
      // Passenger credentials login
      if (account?.provider === "passenger-credentials" || account?.provider === "credentials") {
        (token as any).role = "passenger";
        if (user) {
          token.sub = String((user as any).id || token.sub || "");
          (token as any).phone = (user as any).phone || (token as any).phone;
          (token as any).name = (user as any).name || (token as any).name;
        }
        return token;
      }

      // Google-based admin/dispatcher allowlist role
      const email = (token && (token.email as any)) ? String(token.email) : "";
      (token as any).role = roleFromEmail(email);
      return token;
    },
'@
  $txt = $jwtRegex.Replace($txt, $newJwt, 1)
  Write-Host "[OK] Patched jwt callback."
} else {
  Fail "Could not find jwt callback block to patch."
}

# 4) Patch session callback
$sessionRegex = [regex]'async\s+session\s*\(\s*\{\s*session,\s*token\s*\}\s*\)\s*\{\s*[\s\S]*?\n\s*\},'
if ($sessionRegex.IsMatch($txt)) {
  $newSession = @'
    async session({ session, token }) {
      const role = (token as any)?.role || "admin";
      (session as any).user = (session as any).user || {};
      (session as any).user.role = role;
      (session as any).user.id = String(token?.sub || "");
      if ((token as any)?.phone) (session as any).user.phone = (token as any).phone;
      return session;
    },
'@
  $txt = $sessionRegex.Replace($txt, $newSession, 1)
  Write-Host "[OK] Patched session callback."
} else {
  Fail "Could not find session callback block to patch."
}

Write-Utf8NoBom $authPath $txt
Write-Host "[OK] Wrote: $authPath"
Write-Host ""
Write-Host "NEXT:"
Write-Host "1) Patch passenger login page to use signIn('passenger-credentials')"
Write-Host "2) Ensure /api/public/auth/login returns { ok: true, user: { id, full_name, ... } }"
Write-Host ""
