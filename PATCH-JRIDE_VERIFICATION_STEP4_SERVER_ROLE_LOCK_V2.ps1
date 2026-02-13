# PATCH-JRIDE_VERIFICATION_STEP4_SERVER_ROLE_LOCK_V2.ps1
# Fix: accept existing Vercel env ADMIN_EMAILS (legacy) in addition to JRIDE_ADMIN_EMAILS
# Also accepts DISPATCHER_EMAILS in addition to JRIDE_DISPATCHER_EMAILS
# Full-file replace with backups (no partial patching)

$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$pendingPath = Join-Path $root "app\api\admin\verification\pending\route.ts"
$decidePath  = Join-Path $root "app\api\admin\verification\decide\route.ts"

Backup-File $pendingPath
Backup-File $decidePath

# ---------------- pending route.ts (full replace) ----------------
$pending = @'
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  return (v && String(v).trim()) ? String(v).trim() : "";
}

function parseCsv(v: string) {
  return String(v || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailInList(email: string | null | undefined, list: string[]) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return list.includes(e);
}

async function getRoleFromMetadata(supabase: any, userId: string) {
  try {
    const u = await supabase.auth.admin.getUserById(userId);
    const md: any = u?.data?.user?.user_metadata || {};
    const role = String(md?.role || "").toLowerCase();
    const isAdmin = md?.is_admin === true || role === "admin";
    const isDispatcher = role === "dispatcher";
    return { isAdmin, isDispatcher, role };
  } catch {
    return { isAdmin: false, isDispatcher: false, role: "" };
  }
}

export async function GET() {
  // 1) Require signed-in user (NextAuth)
  const session = await auth();
  const requesterId = session?.user?.id ? String(session.user.id) : "";
  const requesterEmail = session?.user?.email ? String(session.user.email) : "";

  if (!requesterId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  // 2) Build admin supabase client (needed for signed URLs + metadata role check)
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const service =
    env("SUPABASE_SERVICE_ROLE_KEY") ||
    env("SUPABASE_SERVICE_KEY") ||
    env("SUPABASE_SERVICE_ROLE") ||
    "";

  if (!url) {
    return NextResponse.json({ ok: false, error: "Missing SUPABASE_URL" }, { status: 500 });
  }
  if (!service) {
    return NextResponse.json({ ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY (required for private signed URLs)" }, { status: 500 });
  }

  const supabase = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // 3) Role allowlists (support legacy env names too)
  const adminEmails = parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS"));
  const dispatcherEmails = parseCsv(env("JRIDE_DISPATCHER_EMAILS") || env("DISPATCHER_EMAILS"));

  let isAdmin = isEmailInList(requesterEmail, adminEmails);
  let isDispatcher = isEmailInList(requesterEmail, dispatcherEmails);

  // 4) Fallback to auth metadata role (if allowlists not used)
  if (!isAdmin && !isDispatcher) {
    const r = await getRoleFromMetadata(supabase, requesterId);
    isAdmin = r.isAdmin;
    isDispatcher = r.isDispatcher;
  }

  // 5) Enforce: admin OR dispatcher can view pending
  if (!isAdmin && !isDispatcher) {
    return NextResponse.json(
      {
        ok: false,
        error: "Forbidden (requires admin/dispatcher). Set JRIDE_ADMIN_EMAILS or ADMIN_EMAILS; JRIDE_DISPATCHER_EMAILS or DISPATCHER_EMAILS; or user_metadata.role",
      },
      { status: 403 }
    );
  }

  // 6) Pull pending rows
  const { data, error } = await supabase
    .from("passenger_verification_requests")
    .select("passenger_id, full_name, town, status, submitted_at, admin_notes, id_front_path, selfie_with_id_path")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = Array.isArray(data) ? data : [];

  // 7) Create signed urls (private buckets)
  const ID_BUCKET = "passenger-ids";
  const SELFIE_BUCKET = "passenger-selfies";
  const EXPIRES = 60 * 10; // 10 minutes

  const out: any[] = [];
  for (const r of rows) {
    let id_front_signed_url: string | null = null;
    let selfie_signed_url: string | null = null;

    const idPath = r?.id_front_path ? String(r.id_front_path) : "";
    const sfPath = r?.selfie_with_id_path ? String(r.selfie_with_id_path) : "";

    if (idPath) {
      const s = await supabase.storage.from(ID_BUCKET).createSignedUrl(idPath, EXPIRES);
      if (!s.error) id_front_signed_url = s.data?.signedUrl || null;
    }
    if (sfPath) {
      const s = await supabase.storage.from(SELFIE_BUCKET).createSignedUrl(sfPath, EXPIRES);
      if (!s.error) selfie_signed_url = s.data?.signedUrl || null;
    }

    out.push({ ...r, id_front_signed_url, selfie_signed_url });
  }

  return NextResponse.json({ ok: true, rows: out });
}
'@

Set-Content -Path $pendingPath -Value $pending -Encoding UTF8
Write-Host "[DONE] Replaced: $pendingPath"

# ---------------- decide route.ts (full replace) ----------------
$decide = @'
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@supabase/supabase-js";

function parseCsv(v: string) {
  return String(v || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailInList(email: string | null | undefined, list: string[]) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return list.includes(e);
}

function adminSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function isRequesterAdmin(supabase: any, userId: string, email: string) {
  // Allowlist (support legacy env ADMIN_EMAILS too)
  const adminEmails = parseCsv(process.env.JRIDE_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "");
  if (isEmailInList(email, adminEmails)) return true;

  // Fallback: Supabase Auth metadata role
  try {
    const u = await supabase.auth.admin.getUserById(userId);
    const md: any = u?.data?.user?.user_metadata || {};
    const role = String(md?.role || "").toLowerCase();
    if (md?.is_admin === true) return true;
    if (role === "admin") return true;
  } catch {}

  return false;
}

export async function POST(req: Request) {
  try {
    // Require signed in
    const session = await auth();
    const requesterId = session?.user?.id ? String(session.user.id) : "";
    const requesterEmail = session?.user?.email ? String(session.user.email) : "";

    if (!requesterId) {
      return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    }

    const supabase = adminSupabase();

    // Admin-only enforcement
    const okAdmin = await isRequesterAdmin(supabase, requesterId, requesterEmail);
    if (!okAdmin) {
      return NextResponse.json(
        { ok: false, error: "Forbidden (admin only). Set JRIDE_ADMIN_EMAILS or ADMIN_EMAILS; or user_metadata.role/is_admin." },
        { status: 403 }
      );
    }

    const body: any = await req.json().catch(() => ({}));

    const passenger_id = String(body?.passenger_id || "").trim();
    const decision = String(body?.decision || "").trim().toLowerCase();
    const admin_notes = String(body?.admin_notes || "").trim();

    if (!passenger_id) {
      return NextResponse.json({ ok: false, error: "passenger_id required" }, { status: 400 });
    }
    if (decision !== "approve" && decision !== "reject") {
      return NextResponse.json({ ok: false, error: "decision must be approve or reject" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const newStatus = decision === "approve" ? "approved" : "rejected";

    const up = await supabase
      .from("passenger_verification_requests")
      .update({
        status: newStatus,
        reviewed_at: now,
        reviewed_by: "admin",
        admin_notes: admin_notes || null,
      })
      .eq("passenger_id", passenger_id)
      .select("*")
      .maybeSingle();

    if (up.error) {
      return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
    }

    if (decision === "approve") {
      const u = await supabase.auth.admin.updateUserById(passenger_id, {
        user_metadata: { verified: true, night_allowed: true },
      });

      if (u.error) {
        return NextResponse.json({
          ok: true,
          request: up.data,
          warning: "Approved, but failed to update user metadata: " + String(u.error.message || "error"),
        });
      }
    }

    return NextResponse.json({ ok: true, request: up.data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || "error") }, { status: 500 });
  }
}
'@

Set-Content -Path $decidePath -Value $decide -Encoding UTF8
Write-Host "[DONE] Replaced: $decidePath"

Write-Host ""
Write-Host "[NEXT] Run: npm run build"
