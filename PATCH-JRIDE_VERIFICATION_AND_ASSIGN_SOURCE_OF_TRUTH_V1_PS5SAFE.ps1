#requires -Version 5.1
<#
PATCH JRIDE WEB: verification + assign source-of-truth cleanup
PS5-safe, ASCII-only

What it fixes:
1) Verification frontend uses one direct multipart flow only
2) Verification request route becomes the source of truth for auth + upload + DB write
3) Upload route uses same auth model and remains backward-compatible
4) Assign route sets driver_id explicitly
5) Passenger booking normalizes assign.ok from assign route response
6) Ride result panel displays normalized assign.ok
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) { throw $msg }

function EnsureDir($p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

function ReadText($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing file: $path"
  }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function WriteTextUtf8NoBom($path, $content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

function BackupFile($src, $bakDir, $tag) {
  EnsureDir $bakDir
  if (-not (Test-Path -LiteralPath $src)) {
    throw "Missing file: $src"
  }
  $name = [System.IO.Path]::GetFileName($src)
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $dst = Join-Path $bakDir ($name + ".bak." + $tag + "." + $stamp)
  Copy-Item -LiteralPath $src -Destination $dst -Force
  return $dst
}

function ReplaceLiteralOnce($content, $find, $replace, $label) {
  $idx = $content.IndexOf($find)
  if ($idx -lt 0) { Fail "PATCH FAIL ($label): literal not found." }
  $idx2 = $content.IndexOf($find, $idx + $find.Length)
  if ($idx2 -ge 0) { Fail "PATCH FAIL ($label): literal appears multiple times. Refuse to patch." }
  return $content.Replace($find, $replace)
}

function ReplaceLiteralAll($content, $find, $replace, $label) {
  $count = ([regex]::Matches([regex]::Escape($content), [regex]::Escape($find))).Count
  if ($content.IndexOf($find) -lt 0) { Fail "PATCH FAIL ($label): literal not found." }
  return $content.Replace($find, $replace)
}

Write-Host "== PATCH JRIDE WEB: verification + assign source-of-truth cleanup (V1 / PS5-safe) ==" -ForegroundColor Cyan
$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$bakDir = Join-Path $root "_patch_bak"
EnsureDir $bakDir

# -----------------------------
# 1) Replace app/verify/page.tsx
# -----------------------------
$verifyPage = Join-Path $root "app\verify\page.tsx"
$bak1 = BackupFile $verifyPage $bakDir "VERIFY_PAGE_SOURCE_OF_TRUTH_V1"
Write-Host "[OK] Backup: $bak1"

$verifyPageContent = @'
"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";

type VerificationStatus =
  | "submitted"
  | "pending_admin"
  | "approved"
  | "rejected"
  | null;

type VerificationRequest = {
  passenger_id?: string | null;
  full_name?: string | null;
  town?: string | null;
  status?: VerificationStatus;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  admin_notes?: string | null;
  id_front_path?: string | null;
  selfie_with_id_path?: string | null;
};

function niceStatus(status: VerificationStatus): string {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return "Not submitted";
  if (s === "submitted") return "Pending dispatcher review";
  if (s === "pending_admin") return "Pending admin review";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  return s;
}

function isLocked(status: VerificationStatus): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s === "submitted" || s === "pending_admin" || s === "approved";
}

export default function VerifyPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [userId, setUserId] = useState<string>("");

  const [current, setCurrent] = useState<VerificationRequest | null>(null);

  const [fullName, setFullName] = useState("");
  const [town, setTown] = useState("");
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const locked = useMemo(() => isLocked(current?.status || null), [current?.status]);

  async function fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    ms: number
  ) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);

    try {
      const nextInit: RequestInit = {
        ...(init || {}),
        credentials: "include",
        signal: controller.signal,
      };
      return await fetch(input, nextInit);
    } finally {
      clearTimeout(id);
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const sres = await fetchWithTimeout(
        "/api/verify/session-user",
        {
          method: "GET",
          cache: "no-store",
        },
        30000
      );

      const sj: any = await sres.json().catch(() => ({}));
      const uid = sj?.user_id ? String(sj.user_id) : "";

      if (!uid) {
        setAuthed(false);
        setUserId("");
        setCurrent(null);
        return;
      }

      setAuthed(true);
      setUserId(uid);

      const rres = await fetchWithTimeout(
        "/api/public/passenger/verification/request",
        {
          method: "GET",
          cache: "no-store",
        },
        30000
      );

      const rj: any = await rres.json().catch(() => ({}));
      const req = rj?.request ? (rj.request as VerificationRequest) : null;
      setCurrent(req);

      if (req) {
        setFullName(String(req.full_name || ""));
        setTown(String(req.town || ""));
      }
    } catch (e: any) {
      setError("Failed to load verification state: " + String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!authed || !userId) {
      setError("You are not signed in. Please sign in first.");
      return;
    }

    if (locked) {
      setMessage("Already submitted. Please wait for review.");
      return;
    }

    if (!fullName.trim()) {
      setError("Full name is required.");
      return;
    }

    if (!town.trim()) {
      setError("Town is required.");
      return;
    }

    if (!idFrontFile) {
      setError("Please choose an ID front photo.");
      return;
    }

    if (!selfieFile) {
      setError("Please choose a selfie holding your ID.");
      return;
    }

    setSubmitting(true);
    setMessage("Submitting verification...");

    try {
      const fd = new FormData();
      fd.append("full_name", fullName.trim());
      fd.append("town", town.trim());
      fd.append("id_front", idFrontFile);
      fd.append("selfie_with_id", selfieFile);

      const res = await fetchWithTimeout(
        "/api/public/passenger/verification/request",
        {
          method: "POST",
          body: fd,
        },
        120000
      );

      const j: any = await res.json().catch(async () => {
        const t = await res.text().catch(() => "");
        return { ok: false, error: t || "Unknown error" };
      });

      if (!res.ok || !j?.ok) {
        setError(String(j?.error || "Submit failed"));
        setMessage("");
        return;
      }

      if (j?.message) {
        setMessage(String(j.message));
      } else {
        setMessage("Submitted. Please wait for review.");
      }

      await refresh();
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (msg.ToLower().Contains("abort")) {
        setError("Submit timed out. Please try again.");
      } else {
        setError("Submit error: " + msg);
      }
      setMessage("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 text-sm max-w-xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Passenger Verification</h1>
          <p className="text-xs text-gray-600 mt-1">
            Upload your ID details so JRide can verify you.
          </p>
        </div>

        <button
          type="button"
          className="border rounded px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          onClick={refresh}
          disabled={loading || submitting}
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 p-3 rounded border bg-white">
        <div className="text-xs text-gray-600">User ID (UUID)</div>
        <div className="font-mono text-xs break-all mt-1">
          {userId || "(not signed in)"}
        </div>

        <div className="mt-3 text-xs">
          Current status:{" "}
          <span className="font-semibold">
            {loading ? "Loading..." : niceStatus(current?.status || null)}
          </span>
          {current?.status === "rejected" && current?.admin_notes ? (
            <div className="mt-1 text-red-600">
              Reason: {String(current.admin_notes)}
            </div>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4 rounded border bg-white p-4">
        <div>
          <label className="block text-xs text-gray-700 mb-1">Full name</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={loading || submitting || locked}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-700 mb-1">Town</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={town}
            onChange={(e) => setTown(e.target.value)}
            disabled={loading || submitting || locked}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-700 mb-1">ID front photo</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setIdFrontFile(e.target.files?.[0] || null)}
            disabled={loading || submitting || locked}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-700 mb-1">Selfie holding ID</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setSelfieFile(e.target.files?.[0] || null)}
            disabled={loading || submitting || locked}
          />
        </div>

        <button
          type="submit"
          className="rounded bg-black text-white px-4 py-2 disabled:opacity-50"
          disabled={loading || submitting || locked}
        >
          {submitting ? "Submitting..." : locked ? "Locked" : "Submit for verification"}
        </button>
      </form>
    </div>
  );
}
'@
# fix JS method typo in string
$verifyPageContent = $verifyPageContent.Replace('msg.ToLower().Contains("abort")','msg.toLowerCase().includes("abort")')
WriteTextUtf8NoBom $verifyPage $verifyPageContent
Write-Host "[OK] Replaced: $verifyPage"

# -----------------------------
# 2) Replace app/verification/page.tsx
# -----------------------------
$verificationPage = Join-Path $root "app\verification\page.tsx"
$bak2 = BackupFile $verificationPage $bakDir "VERIFICATION_ALIAS_V1"
Write-Host "[OK] Backup: $bak2"
WriteTextUtf8NoBom $verificationPage 'export { default } from "../verify/page";' 
Write-Host "[OK] Replaced: $verificationPage"

# -----------------------------
# 3) Replace verification request route
# -----------------------------
$requestRoute = Join-Path $root "app\api\public\passenger\verification\request\route.ts"
$bak3 = BackupFile $requestRoute $bakDir "VERIFY_REQUEST_ROUTE_V1"
Write-Host "[OK] Backup: $bak3"

$requestContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type VerificationStatus = "submitted" | "pending_admin" | "approved" | "rejected";

function env(name: string) {
  return process.env[name] || "";
}

function nowIso() {
  return new Date().toISOString();
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) {
    throw new Error("Missing Supabase service role env (SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET() {
  const supabase = createClient();

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (userErr || !user?.id) {
    return NextResponse.json({ ok: true, authed: false }, { status: 200 });
  }

  const passenger_id = user.id;

  const r = await supabase
    .from("passenger_verification_requests")
    .select("*")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    authed: true,
    passenger_id,
    request: !r.error ? r.data : null,
    db_error: r.error ? r.error.message : null,
  });
}

export async function POST(req: Request) {
  const supabase = createClient();

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (userErr || !user?.id) {
    return NextResponse.json(
      { ok: false, error: "Not signed in (Supabase session missing)" },
      { status: 401 }
    );
  }

  const passenger_id = user.id;
  const idBucket = process.env.VERIFICATION_ID_BUCKET || "passenger-ids";
  const selfieBucket = process.env.VERIFICATION_SELFIE_BUCKET || "passenger-selfies";

  const ct = req.headers.get("content-type") || "";

  let full_name = "";
  let town = "";
  let id_front_path = "";
  let selfie_with_id_path = "";

  async function uploadToBucket(file: File, bucketName: string, keyPrefix: string) {
    const ext = file?.name && file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const safeExt = String(ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

    const key = `${keyPrefix}/${passenger_id}/${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}.${safeExt}`;

    const admin = adminClient();
    const ab = await file.arrayBuffer();

    const up = await admin.storage.from(bucketName).upload(key, ab, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });

    if (up.error) {
      throw new Error(`Storage upload failed (bucket=${bucketName}): ${up.error.message}`);
    }

    return key;
  }

  try {
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();

      full_name = String(fd.get("full_name") || fd.get("fullName") || fd.get("fullname") || "").trim();
      town = String(fd.get("town") || fd.get("Town") || "").trim();

      const idFrontAny = fd.get("id_front");
      const selfieAny = fd.get("selfie_with_id");

      id_front_path = String(fd.get("id_front_path") || "").trim();
      selfie_with_id_path = String(fd.get("selfie_with_id_path") || "").trim();

      if (!id_front_path && idFrontAny && typeof idFrontAny === "object") {
        id_front_path = await uploadToBucket(idFrontAny as File, idBucket, "id_front");
      }
      if (!selfie_with_id_path && selfieAny && typeof selfieAny === "object") {
        selfie_with_id_path = await uploadToBucket(selfieAny as File, selfieBucket, "selfie_with_id");
      }
    } else {
      const body: any = await req.json().catch(() => ({}));
      full_name = String(body?.full_name || "").trim();
      town = String(body?.town || "").trim();

      id_front_path = body?.id_front_path ? String(body.id_front_path).trim() : "";
      selfie_with_id_path = body?.selfie_with_id_path ? String(body.selfie_with_id_path).trim() : "";
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Upload/parse failed: " + (e?.message || String(e)) },
      { status: 400 }
    );
  }

  if (!full_name) return NextResponse.json({ ok: false, error: "Full name required" }, { status: 400 });
  if (!town) return NextResponse.json({ ok: false, error: "Town required" }, { status: 400 });
  if (!id_front_path) {
    return NextResponse.json(
      { ok: false, error: "ID front required (upload failed or missing)." },
      { status: 400 }
    );
  }
  if (!selfie_with_id_path) {
    return NextResponse.json(
      { ok: false, error: "Selfie-with-ID required (upload failed or missing)." },
      { status: 400 }
    );
  }

  const existing = await supabase
    .from("passenger_verification_requests")
    .select("passenger_id,status,submitted_at,reviewed_at,reviewed_by,admin_notes,full_name,town,id_front_path,selfie_with_id_path")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json(
      { ok: false, error: "DB read failed: " + existing.error.message },
      { status: 400 }
    );
  }

  const ex = existing.data as any | null;
  const exStatus = (ex?.status ? String(ex.status) : "") as VerificationStatus | "";

  if (ex && (exStatus === "approved" || exStatus === "pending_admin")) {
    return NextResponse.json({
      ok: true,
      request: ex,
      message: exStatus === "approved" ? "Already approved." : "Already forwarded to admin (pending_admin).",
    });
  }

  const nextStatus: VerificationStatus = "submitted";
  const ts = nowIso();

  if (!ex) {
    const ins = await supabase
      .from("passenger_verification_requests")
      .insert({
        passenger_id,
        full_name,
        town,
        status: nextStatus,
        submitted_at: ts,
        id_front_path,
        selfie_with_id_path,
      })
      .select("*")
      .single();

    if (ins.error) {
      return NextResponse.json(
        { ok: false, error: ins.error.message, hint: "Insert blocked (likely RLS) or column mismatch" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, request: ins.data });
  }

  const upd = await supabase
    .from("passenger_verification_requests")
    .update({
      full_name,
      town,
      status: nextStatus,
      submitted_at: ts,
      reviewed_at: null,
      reviewed_by: null,
      admin_notes: null,
      id_front_path,
      selfie_with_id_path,
    })
    .eq("passenger_id", passenger_id)
    .select("*")
    .single();

  if (upd.error) {
    return NextResponse.json(
      { ok: false, error: upd.error.message, hint: "Update blocked (likely RLS) or column mismatch" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, request: upd.data });
}
'@
WriteTextUtf8NoBom $requestRoute $requestContent
Write-Host "[OK] Replaced: $requestRoute"

# -----------------------------
# 4) Replace verification upload route to same auth/storage model
# -----------------------------
$uploadRoute = Join-Path $root "app\api\public\passenger\verification\upload\route.ts"
$bak4 = BackupFile $uploadRoute $bakDir "VERIFY_UPLOAD_ROUTE_V1"
Write-Host "[OK] Backup: $bak4"

$uploadContent = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

function env(name: string) {
  return process.env[name] || "";
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) {
    throw new Error("Missing Supabase service role env (SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function extFromMime(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "bin";
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const user = userRes?.user;

    if (userErr || !user?.id) {
      return NextResponse.json(
        { ok: false, error: "Not signed in" },
        { status: 401 }
      );
    }

    const form = await req.formData();
    const kind = String(form.get("kind") || "").trim();
    const file = form.get("file");

    if (kind !== "id_front" && kind !== "selfie") {
      return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const mime = String(file.type || "");
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Image only" }, { status: 400 });
    }

    const bytes = Number(file.size || 0);
    if (bytes > 5 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "Max 5MB" }, { status: 400 });
    }

    const passengerId = user.id;
    const bucket = kind === "id_front" ? "passenger-ids" : "passenger-selfies";
    const ext = extFromMime(mime);
    const path = `${passengerId}/${Date.now()}_${kind}.${ext}`;

    const admin = adminClient();
    const ab = await file.arrayBuffer();

    const up = await admin.storage.from(bucket).upload(path, ab, {
      contentType: mime || "application/octet-stream",
      upsert: true,
    });

    if (up.error) {
      return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, bucket, path, bytes, mime },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e || "error") },
      { status: 500 }
    );
  }
}
'@
WriteTextUtf8NoBom $uploadRoute $uploadContent
Write-Host "[OK] Replaced: $uploadRoute"

# -----------------------------
# 5) Patch dispatch assign route to also set driver_id
# -----------------------------
$assignRoute = Join-Path $root "app\api\dispatch\assign\route.ts"
$bak5 = BackupFile $assignRoute $bakDir "DISPATCH_ASSIGN_DRIVERID_V1"
Write-Host "[OK] Backup: $bak5"

$assignText = ReadText $assignRoute
$oldAssignPatch = @'
    const patch: any = {
      status: "assigned",
      assigned_driver_id: chosenDriverId,
      assigned_at: new Date().toISOString(),
    };
'@
$newAssignPatch = @'
    const patch: any = {
      status: "assigned",
      driver_id: chosenDriverId,
      assigned_driver_id: chosenDriverId,
      assigned_at: new Date().toISOString(),
    };
'@
if ($assignText.IndexOf($oldAssignPatch) -ge 0) {
  $assignText = ReplaceLiteralOnce $assignText $oldAssignPatch $newAssignPatch "ASSIGN_ROUTE_ADD_DRIVER_ID"
} elseif ($assignText.IndexOf('driver_id: chosenDriverId,') -lt 0) {
  Fail "PATCH FAIL (ASSIGN_ROUTE_ADD_DRIVER_ID): expected patch block not found."
}
WriteTextUtf8NoBom $assignRoute $assignText
Write-Host "[OK] Patched: $assignRoute"

# -----------------------------
# 6) Patch passenger booking route normalize assign result
# -----------------------------
$bookRoute = Join-Path $root "app\api\public\passenger\book\route.ts"
$bak6 = BackupFile $bookRoute $bakDir "PASSENGER_BOOK_NORMALIZE_ASSIGN_V1"
Write-Host "[OK] Backup: $bak6"

$bookText = ReadText $bookRoute
if ($bookText.IndexOf("function normalizeAssignResult(") -lt 0) {
  $marker = "function jrideEnvEcho()"
  $insert = @'
function normalizeAssignResult(j: any) {
  const src = j || {};
  const ok =
    !!src.ok ||
    !!src.assign_ok ||
    !!src.update_ok ||
    !!src.notify_ok ||
    !!src.assigned_driver_id ||
    !!src.driver_id ||
    !!src.toDriverId;

  return {
    ...src,
    ok,
  };
}

'@
  $idx = $bookText.IndexOf($marker)
  if ($idx -lt 0) { Fail "PATCH FAIL (BOOK_ROUTE_INSERT_HELPER): marker not found." }
  $bookText = $bookText.Substring(0, $idx) + $insert + $bookText.Substring($idx)
}

$bookText = $bookText.Replace("  assign = j;", "  assign = normalizeAssignResult(j);")
WriteTextUtf8NoBom $bookRoute $bookText
Write-Host "[OK] Patched: $bookRoute"

# -----------------------------
# 7) Patch ride page result rendering
# -----------------------------
$ridePage = Join-Path $root "app\ride\page.tsx"
$bak7 = BackupFile $ridePage $bakDir "RIDE_PAGE_ASSIGN_OK_V1"
Write-Host "[OK] Backup: $bak7"

$rideText = ReadText $ridePage
$oldRideLine = '        lines.push("assign.ok: " + String(!!bj.assign.ok));'
$newRideLine = '        lines.push("assign.ok: " + String(!!(bj.assign.ok || bj.assign.assign_ok)));'
if ($rideText.IndexOf($oldRideLine) -ge 0) {
  $rideText = ReplaceLiteralOnce $rideText $oldRideLine $newRideLine "RIDE_PAGE_ASSIGN_OK_RENDER"
}
WriteTextUtf8NoBom $ridePage $rideText
Write-Host "[OK] Patched: $ridePage"

Write-Host ""
Write-Host "== PATCH COMPLETE ==" -ForegroundColor Green
Write-Host "Files replaced/patched:"
Write-Host "  app/verify/page.tsx"
Write-Host "  app/verification/page.tsx"
Write-Host "  app/api/public/passenger/verification/request/route.ts"
Write-Host "  app/api/public/passenger/verification/upload/route.ts"
Write-Host "  app/api/dispatch/assign/route.ts"
Write-Host "  app/api/public/passenger/book/route.ts"
Write-Host "  app/ride/page.tsx"