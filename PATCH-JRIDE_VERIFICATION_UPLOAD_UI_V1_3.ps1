# PATCH-JRIDE_VERIFICATION_UPLOAD_UI_V1_3.ps1
# ASCII-only. UTF-8 no BOM. Creates backup.
# Injects upload UI before the first submit button by anchoring on type="submit".

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function ReadU($p){ [IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false)) }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }
function Fail($m){ throw $m }

$root = Get-Location
$stamp = NowStamp

$verPage = Join-Path $root "app\verification\page.tsx"
if(!(Test-Path $verPage)){ Fail "Missing: $verPage" }

Copy-Item $verPage "$verPage.bak.$stamp" -Force
$p = ReadU $verPage

# --- ensure React import (no concat inside -replace)
if($p -notmatch 'import\s+\*\s+as\s+React\s+from\s+"react"') {
  if($p.Contains('"use client";')) {
    $p = $p.Replace('"use client";', @'
"use client";
import * as React from "react";
'@.TrimEnd("`r","`n"))
  } else {
    $p = 'import * as React from "react";' + "`r`n" + $p
  }
}

# --- add upload state + helper after fullName state (anchor)
if($p -notmatch 'const\s+\[idFrontPath,\s*setIdFrontPath\]') {
  $mFull = [regex]::Match($p, 'const\s+\[fullName[^\n]*\n')
  if(-not $mFull.Success){ Fail "Could not find fullName state to anchor upload state injection." }

  $inj = @'
  const [idFrontPath, setIdFrontPath] = React.useState<string>("");
  const [selfiePath, setSelfiePath] = React.useState<string>("");
  const [uploading, setUploading] = React.useState<string>("");
  const [uploadErr, setUploadErr] = React.useState<string>("");

  async function uploadOne(kind: "id_front" | "selfie", file: File) {
    setUploadErr("");
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", file);
      const r = await fetch("/api/public/passenger/verification/upload", { method: "POST", body: fd });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Upload failed");
      const path = String(j?.path || "");
      if (kind === "id_front") setIdFrontPath(path);
      else setSelfiePath(path);
    } catch (e: any) {
      setUploadErr(String(e?.message || e || "Upload failed"));
    } finally {
      setUploading("");
    }
  }

'@

  $pos = $mFull.Index + $mFull.Length
  $p = $p.Insert($pos, $inj)
}

# --- upload UI block
$ui = @'
<div className="mt-3 grid grid-cols-1 gap-3">
  <div>
    <div className="text-sm font-semibold mb-1">Upload valid ID (front)</div>
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp"
      onChange={(e) => {
        const f = e.target.files && e.target.files[0];
        if (f) uploadOne("id_front", f);
      }}
    />
    <div className="text-xs opacity-70 mt-1">
      {uploading === "id_front" ? "Uploading..." : (idFrontPath ? ("Saved: " + idFrontPath) : "No file yet")}
    </div>
  </div>

  <div>
    <div className="text-sm font-semibold mb-1">Selfie holding the ID</div>
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp"
      onChange={(e) => {
        const f = e.target.files && e.target.files[0];
        if (f) uploadOne("selfie", f);
      }}
    />
    <div className="text-xs opacity-70 mt-1">
      {uploading === "selfie" ? "Uploading..." : (selfiePath ? ("Saved: " + selfiePath) : "No file yet")}
    </div>
  </div>

  {uploadErr ? (
    <div className="text-sm text-red-600">Upload error: {uploadErr}</div>
  ) : null}
</div>

'@

# --- inject UI before first submit control
if($p -notmatch "Upload valid ID \(front\)") {
  $mSubmit = [regex]::Match($p, 'type\s*=\s*["' + "'" + ']submit["' + "'" + ']')
  if($mSubmit.Success) {
    # insert before the start of the tag containing type="submit"
    $before = $p.LastIndexOf("<", $mSubmit.Index)
    if($before -lt 0){ $before = $mSubmit.Index }
    $p = $p.Insert($before, $ui)
  } else {
    # fallback: text anchor
    $mTxt = [regex]::Match($p, 'Submit\s+for\s+verification')
    if($mTxt.Success) {
      $before2 = $p.LastIndexOf("<", $mTxt.Index)
      if($before2 -lt 0){ $before2 = $mTxt.Index }
      $p = $p.Insert($before2, $ui)
    } else {
      Fail "Could not find submit anchor (type=`"submit`") or text anchor (Submit for verification)."
    }
  }
}

# --- ensure request payload includes the paths (best-effort)
if($p -notmatch "id_front_path") {
  $p = [regex]::Replace(
    $p,
    '(JSON\.stringify\(\s*\{)([^}]*)(\}\s*\))',
    '${1}${2}, id_front_path: idFrontPath || null, selfie_with_id_path: selfiePath || null${3}',
    1
  )
}

WriteU $verPage $p
Write-Host "[OK] Patched verification UI: $verPage"
Write-Host "[DONE] V1.3 UI patch complete."
