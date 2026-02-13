# PATCH-JRIDE_CANBOOK_LOCAL_VERIFY_BYPASS_V7.ps1
# Purpose:
# - Patch app\api\public\passenger\can-book\route.ts (POST handler)
# - Honor local_verification_code/local_verify by bypassing the verification gate (can-book only)
# - Uses env JRIDE_LOCAL_VERIFY_CODE
# Safety:
# - Timestamped backup
# - Anchor-based patching, throws if expected anchors are missing
# Notes:
# - This does NOT change wallet rules.
# - This does NOT change the GET handler.
# - This only changes can-book eligibility (POST).

$ErrorActionPreference = "Stop"

$repo   = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$target = Join-Path $repo "app\api\public\passenger\can-book\route.ts"

if (!(Test-Path $target)) { throw "File not found: $target" }

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $target

# -------------------------------
# PATCH 1: Inject localOk after the body parse line in POST(req: Request)
# Anchor: const body = (await req.json().catch(() => ({}))) as CanBookReq;
# -------------------------------
$bodyLine = 'const body = (await req.json().catch(() => ({}))) as CanBookReq;'
$idxBody = $txt.IndexOf($bodyLine)
if ($idxBody -lt 0) {
  throw "Anchor not found: POST body parse line: $bodyLine"
}

# Prevent duplicate injection
if ($txt -match "const\s+localOk\s*=") {
  Write-Host "[OK] localOk already present; skipping injection."
} else {
  $inject = @'
  // ---- JRIDE local verification bypass (can-book only) ----
  // If local_verification_code matches JRIDE_LOCAL_VERIFY_CODE, bypass the verification gate in this endpoint only.
  const expectedLocal = String(process.env.JRIDE_LOCAL_VERIFY_CODE || "").trim();
  const providedLocal = String((body as any)?.local_verification_code || (body as any)?.local_verify || "").trim();
  const localOk = !!expectedLocal && !!providedLocal && (providedLocal === expectedLocal);
  // --------------------------------------------------------
'@

  $insertPos = $idxBody + $bodyLine.Length
  $txt = $txt.Substring(0, $insertPos) + "`r`n`r`n" + $inject + "`r`n" + $txt.Substring($insertPos)
  Write-Host "[OK] Injected localOk after POST body parse line."
}

# -------------------------------
# PATCH 2: Modify verification gate
# Anchor: if (!v.verified) {
# Replace with: if (!v.verified && !localOk) {
# -------------------------------
$gateOld = "if (!v.verified) {"
if ($txt.IndexOf($gateOld) -lt 0) {
  throw "Anchor not found: verification gate line: $gateOld"
}
$txt = $txt.Replace($gateOld, "if (!v.verified && !localOk) {")
Write-Host "[OK] Patched verification gate to allow localOk bypass."

# -------------------------------
# PATCH 3: Add local_bypass_used to the blocked response (best-effort, but anchored)
# Anchor inside blocked response object: ok: false,
# We inject local_bypass_used: localOk, right after ok: false,
# -------------------------------
$blockedAnchor = "ok: false,"
$blockedPos = $txt.IndexOf($blockedAnchor)
if ($blockedPos -lt 0) {
  throw "Anchor not found: blocked response 'ok: false,'"
}
# Only inject if not already present
if ($txt -notmatch "local_bypass_used") {
  $txt = $txt.Remove($blockedPos + $blockedAnchor.Length, 0).Insert($blockedPos + $blockedAnchor.Length, "`r`n        local_bypass_used: localOk,")
  Write-Host "[OK] Injected local_bypass_used into blocked response."
} else {
  Write-Host "[OK] local_bypass_used already present; skipping injection."
}

# -------------------------------
# PATCH 4: Add local_bypass_used to allowed:true success response (best-effort)
# Anchor: ok: true, in the POST success response block (later in file)
# We inject only the first occurrence AFTER the POST handler begins.
# -------------------------------
$postStart = $txt.IndexOf("export async function POST(req: Request)")
if ($postStart -lt 0) {
  throw "Anchor not found: export async function POST(req: Request)"
}

$okTrueAfterPost = $txt.IndexOf("ok: true,", $postStart)
if ($okTrueAfterPost -lt 0) {
  throw "Anchor not found: ok: true, after POST start"
}

# Inject only if not present near that area
$window = $txt.Substring($okTrueAfterPost, [Math]::Min(400, $txt.Length - $okTrueAfterPost))
if ($window -notmatch "local_bypass_used") {
  $txt = $txt.Remove($okTrueAfterPost + "ok: true,".Length, 0).Insert($okTrueAfterPost + "ok: true,".Length, "`r`n      local_bypass_used: localOk,")
  Write-Host "[OK] Injected local_bypass_used into POST ok:true response."
} else {
  Write-Host "[OK] POST ok:true already has local_bypass_used; skipping injection."
}

# Write back UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)

Write-Host "[DONE] Patched: $target"
Write-Host ""
Write-Host "[REMINDER] Add to .env.local: JRIDE_LOCAL_VERIFY_CODE=3607"
