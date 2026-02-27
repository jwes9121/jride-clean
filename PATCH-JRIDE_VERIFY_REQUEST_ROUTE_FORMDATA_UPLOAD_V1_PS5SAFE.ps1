param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($m) { Write-Host $m -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host $m -ForegroundColor Green }
function Write-Fail($m) { Write-Host $m -ForegroundColor Red }

Write-Info "== JRIDE Patch: verification request route supports FormData + storage upload (V1 / PS5-safe) =="

$proj = (Resolve-Path -LiteralPath $ProjRoot).Path
$target = Join-Path $proj "app\api\public\passenger\verification\request\route.ts"

if (!(Test-Path -LiteralPath $target)) {
  Write-Fail "[FAIL] Not found: $target"
  exit 1
}

# backup
$bakDir = Join-Path $proj "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.bak.VERIFY_REQUEST_FORMDATA_UPLOAD_V1.$stamp")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Ok "[OK] Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw

# Replace the POST body parsing block with multipart+json support + storage upload.
# We locate the line: const body: any = await req.json().catch(() => ({}));
# and replace from there through the id_front_path/selfie_with_id_path extraction.

$pattern = [regex]::Escape('  const body: any = await req.json().catch(() => ({}));') + '([\s\S]*?)' + [regex]::Escape('  const id_front_path = body?.id_front_path ? String(body.id_front_path).trim() : "";') + '[\s\S]*?' + [regex]::Escape('  const selfie_with_id_path = body?.selfie_with_id_path ? String(body.selfie_with_id_path).trim() : "";')

if ($src -notmatch $pattern) {
  Write-Fail "[FAIL] Could not locate the POST json/body parsing block to patch."
  Write-Info "Open the file and confirm it still contains 'await req.json()' and the id_front_path/selfie_with_id_path extraction."
  exit 2
}

$replacement = @'
  const bucket = process.env.VERIFICATION_BUCKET || "passenger-verifications";

  // Accept BOTH JSON and multipart/form-data
  const ct = req.headers.get("content-type") || "";

  let full_name = "";
  let town = "";

  // These are the DB fields your table expects:
  // - id_front_path
  // - selfie_with_id_path
  let id_front_path = "";
  let selfie_with_id_path = "";

  // Optional URL fields if your client provides them
  let id_photo_url = "";
  let selfie_photo_url = "";

  // Helper: upload a file to Supabase Storage and return its path
  async function uploadToBucket(file: File, keyPrefix: string) {
    const ext = (file.name && file.name.includes(".")) ? file.name.split(".").pop() : "jpg";
    const safeExt = String(ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const key = `${keyPrefix}/${passenger_id}/${Date.now()}_${Math.random().toString(16).slice(2)}.${safeExt}`;

    const up = await supabase.storage.from(bucket).upload(key, file, {
      contentType: file.type || "application/octet-stream",
      upsert: true
    });

    if (up.error) {
      throw new Error(`Storage upload failed (bucket=${bucket}): ${up.error.message}`);
    }
    return key;
  }

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();

    full_name = String(fd.get("full_name") || "").trim();
    town = String(fd.get("town") || "").trim();

    // Accept either file uploads OR pre-existing path/url strings
    const idFrontAny = fd.get("id_front");
    const selfieAny = fd.get("selfie_with_id");

    id_front_path = String(fd.get("id_front_path") || "").trim();
    selfie_with_id_path = String(fd.get("selfie_with_id_path") || "").trim();

    id_photo_url = String(fd.get("id_photo_url") || "").trim();
    selfie_photo_url = String(fd.get("selfie_photo_url") || "").trim();

    // If files are provided, upload them and set paths
    if (!id_front_path && idFrontAny && typeof idFrontAny === "object") {
      const f = idFrontAny as File;
      id_front_path = await uploadToBucket(f, "id_front");
    }
    if (!selfie_with_id_path && selfieAny && typeof selfieAny === "object") {
      const f = selfieAny as File;
      selfie_with_id_path = await uploadToBucket(f, "selfie_with_id");
    }
  } else {
    // JSON fallback
    const body: any = await req.json().catch(() => ({}));
    full_name = String(body?.full_name || "").trim();
    town = String(body?.town || "").trim();

    id_front_path = body?.id_front_path ? String(body.id_front_path).trim() : "";
    selfie_with_id_path = body?.selfie_with_id_path ? String(body.selfie_with_id_path).trim() : "";

    id_photo_url = body?.id_photo_url ? String(body.id_photo_url).trim() : "";
    selfie_photo_url = body?.selfie_photo_url ? String(body.selfie_photo_url).trim() : "";
  }
'@

$src2 = [regex]::Replace($src, $pattern, $replacement, 1)

# Also update the validation errors text to mention bucket/env if paths are missing after upload attempt
$src2 = $src2 -replace [regex]::Escape('  if (!id_front_path) return NextResponse.json({ ok: false, error: "ID front path required" }, { status: 400 });'),
'  if (!id_front_path) return NextResponse.json({ ok: false, error: "ID front required (file upload failed or missing). If using file upload, ensure VERIFICATION_BUCKET is set correctly on Vercel." }, { status: 400 });'

$src2 = $src2 -replace [regex]::Escape('  if (!selfie_with_id_path) return NextResponse.json({ ok: false, error: "Selfie-with-ID path required" }, { status: 400 });'),
'  if (!selfie_with_id_path) return NextResponse.json({ ok: false, error: "Selfie-with-ID required (file upload failed or missing). If using file upload, ensure VERIFICATION_BUCKET is set correctly on Vercel." }, { status: 400 });'

Set-Content -LiteralPath $target -Value $src2 -Encoding UTF8
Write-Ok "[OK] Patched: $target"

Write-Host ""
Write-Info "IMPORTANT: Set VERIFICATION_BUCKET in Vercel env if your bucket name is not 'passenger-verifications'."