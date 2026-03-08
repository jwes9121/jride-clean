param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE Patch: verify hardening (V2 / PS5-safe) =="
Write-Host "Root: $ProjRoot"

function Read-TextUtf8 {
  param([Parameter(Mandatory=$true)][string]$Path)
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-TextUtf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  if (!(Test-Path -LiteralPath $Path)) {
    throw "Missing file: $Path"
  }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($Path)
  $bak = Join-Path $bakDir ($name + ".bak." + $Tag + "." + $stamp)
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Replace-RegexSingle {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Pattern,
    [Parameter(Mandatory=$true)][string]$Replacement,
    [Parameter(Mandatory=$true)][string]$Label
  )

  $content = Read-TextUtf8 -Path $Path
  $rx = New-Object System.Text.RegularExpressions.Regex(
    $Pattern,
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  $m = $rx.Match($content)
  if (!$m.Success) {
    throw "Pattern not found for $Label in $Path"
  }

  $updated = $rx.Replace($content, $Replacement, 1)
  if ($updated -eq $content) {
    throw "Replacement produced no change for $Label in $Path"
  }

  Write-TextUtf8NoBom -Path $Path -Content $updated
  Write-Host "[OK] Patched: $Label"
}

$verifyPagePath = Join-Path $ProjRoot "app\verify\page.tsx"
$verifyRoutePath = Join-Path $ProjRoot "app\api\public\passenger\verification\request\route.ts"

Backup-File -Path $verifyPagePath -Tag "VERIFY_HARDENING_V2"
Backup-File -Path $verifyRoutePath -Tag "VERIFY_HARDENING_V2"

# 1) Replace the submit response handling block in app/verify/page.tsx
$patternVerifyPage = 'const res = await fetchWithTimeout\(\s*"/api/public/passenger/verification/request",\s*\{\s*method:\s*"POST",\s*body:\s*fd,\s*\},\s*120000\s*\);\s*const j:\s*any = await res\.json\(\)\.catch\(async \(\) => \{\s*const t = await res\.text\(\)\.catch\(\(\) => ""\);\s*return \{ ok: false, error: t \|\| "Unknown error" \};\s*\}\);\s*if \(!res\.ok \|\| !j\?\.ok\) \{\s*setError\(String\(j\?\.error \|\| "Submit failed"\)\);\s*setMessage\(""\);\s*return;\s*\}\s*if \(j\?\.message\) \{\s*setMessage\(String\(j\.message\)\);\s*\} else \{\s*setMessage\("Submitted\. Please wait for review\."\);\s*\}\s*await refresh\(\);'
$replacementVerifyPage = @'
const res = await fetchWithTimeout(
        "/api/public/passenger/verification/request",
        {
          method: "POST",
          body: fd,
        },
        120000
      );

      const rawText = await res.text().catch(() => "");
      let j: any = null;

      try {
        j = rawText ? JSON.parse(rawText) : null;
      } catch {
        j = null;
      }

      if (!res.ok || !j?.ok) {
        const parts: string[] = [];

        if (!res.ok) {
          parts.push("HTTP " + String(res.status));
        }

        if (j?.error) {
          parts.push(String(j.error));
        } else if (j?.message) {
          parts.push(String(j.message));
        } else if (rawText) {
          parts.push(rawText);
        } else {
          parts.push("Empty or non-JSON response from verification API");
        }

        if (j?.hint) {
          parts.push("Hint: " + String(j.hint));
        }

        setError(parts.join(" | "));
        setMessage("");
        return;
      }

      if (j?.message) {
        setMessage(String(j.message));
      } else {
        setMessage("Submitted. Please wait for review.");
      }

      await refresh();
'@
Replace-RegexSingle -Path $verifyPagePath -Pattern $patternVerifyPage -Replacement $replacementVerifyPage -Label "Verify page submit response handling"

# 2) Replace the entire POST handler in verification route with a top-level JSON-safe version
$patternVerifyRoute = 'export async function POST\(req: Request\) \{.*?\n\}'
$replacementVerifyRoute = @'
export async function POST(req: Request) {
  try {
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

      const key =
        keyPrefix + "/" + passenger_id + "/" + Date.now() + "_" + Math.random().toString(16).slice(2) + "." + safeExt;

      const admin = adminClient();
      const ab = await file.arrayBuffer();

      const up = await admin.storage.from(bucketName).upload(key, ab, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });

      if (up.error) {
        throw new Error("Storage upload failed (bucket=" + bucketName + "): " + up.error.message);
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
        { ok: false, error: "Upload/parse failed: " + String(e?.message || e) },
        { status: 400 }
      );
    }

    if (!full_name) {
      return NextResponse.json({ ok: false, error: "Full name required" }, { status: 400 });
    }

    if (!town) {
      return NextResponse.json({ ok: false, error: "Town required" }, { status: 400 });
    }

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
    const exStatus = ex?.status ? String(ex.status) : "";

    if (ex && (exStatus === "approved" || exStatus === "pending_admin")) {
      return NextResponse.json({
        ok: true,
        request: ex,
        message: exStatus === "approved" ? "Already approved." : "Already forwarded to admin (pending_admin).",
      });
    }

    const nextStatus = "submitted";
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
          { ok: false, error: ins.error.message, hint: "Insert blocked or schema mismatch" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        request: ins.data,
        message: "Submitted. Please wait for review.",
      });
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
        { ok: false, error: upd.error.message, hint: "Update blocked or schema mismatch" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      request: upd.data,
      message: "Submitted. Please wait for review.",
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unhandled verification submit error: " + String(e?.message || e),
      },
      { status: 500 }
    );
  }
}
'@
Replace-RegexSingle -Path $verifyRoutePath -Pattern $patternVerifyRoute -Replacement $replacementVerifyRoute -Label "Verification route POST JSON safety"

Write-Host "[DONE] Patch applied."