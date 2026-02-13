# PATCH-JRIDE_VERIFICATION_STEP4_DEBUG_PENDING_V1.ps1
# Adds SAFE debug fields to /api/admin/verification/pending 403 response:
# - shows requesterEmail (as seen by server)
# - shows admin/dispatcher list counts
# - shows whether email matched
# - shows metadata-derived role flags
# No allowlist contents are returned.

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

Backup-File $pendingPath

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
    return { isAdmin, isDispatcher, role, hasMetadata: true };
  } catch {
    return { isAdmin: false, isDispatcher: false, role: "", hasMetadata: false };
  }
}

export async function GET() {
  const session = await auth();
  const requesterId = session?.user?.id ? String(session.user.id) : "";
  const requesterEmail = session?.user?.email ? String(session.user.email) : "";

  if (!requesterId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

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

  // Allowlists (support legacy env names)
  const adminListRaw = env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS");
  const dispatcherListRaw = env("JRIDE_DISPATCHER_EMAILS") || env("DISPATCHER_EMAILS");

  const adminEmails = parseCsv(adminListRaw);
  const dispatcherEmails = parseCsv(dispatcherListRaw);

  const emailMatchedAdmin = isEmailInList(requesterEmail, adminEmails);
  const emailMatchedDispatcher = isEmailInList(requesterEmail, dispatcherEmails);

  let isAdmin = emailMatchedAdmin;
  let isDispatcher = emailMatchedDispatcher;

  // Fallback: metadata role
  const mdRole = (!isAdmin && !isDispatcher) ? await getRoleFromMetadata(supabase, requesterId) : { isAdmin: false, isDispatcher: false, role: "", hasMetadata: false };
  if (!isAdmin && !isDispatcher) {
    isAdmin = mdRole.isAdmin;
    isDispatcher = mdRole.isDispatcher;
  }

  if (!isAdmin && !isDispatcher) {
    return NextResponse.json(
      {
        ok: false,
        error: "Forbidden (requires admin/dispatcher). Set JRIDE_ADMIN_EMAILS or ADMIN_EMAILS; JRIDE_DISPATCHER_EMAILS or DISPATCHER_EMAILS; or user_metadata.role",
        debug: {
          requesterEmail: requesterEmail || null,
          adminListVarUsed: adminListRaw ? (env("JRIDE_ADMIN_EMAILS") ? "JRIDE_ADMIN_EMAILS" : "ADMIN_EMAILS") : null,
          dispatcherListVarUsed: dispatcherListRaw ? (env("JRIDE_DISPATCHER_EMAILS") ? "JRIDE_DISPATCHER_EMAILS" : "DISPATCHER_EMAILS") : null,
          adminListCount: adminEmails.length,
          dispatcherListCount: dispatcherEmails.length,
          emailMatchedAdmin,
          emailMatchedDispatcher,
          metadataChecked: (!emailMatchedAdmin && !emailMatchedDispatcher),
          metadataHasData: (mdRole as any)?.hasMetadata ?? false,
          metadataRole: (mdRole as any)?.role ?? "",
          metadataIsAdmin: (mdRole as any)?.isAdmin ?? false,
          metadataIsDispatcher: (mdRole as any)?.isDispatcher ?? false,
        },
      },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("passenger_verification_requests")
    .select("passenger_id, full_name, town, status, submitted_at, admin_notes, id_front_path, selfie_with_id_path")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = Array.isArray(data) ? data : [];

  const ID_BUCKET = "passenger-ids";
  const SELFIE_BUCKET = "passenger-selfies";
  const EXPIRES = 60 * 10;

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
Write-Host ""
Write-Host "[NEXT] npm run build"
