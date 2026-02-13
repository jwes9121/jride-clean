# PATCH-JRIDE_PHASE8B_FIX_FORCE_AUDIT_STATUS_API.ps1
# Fix FORCE_STATUS audit logging in app/api/dispatch/status/route.ts
# - Fixes to_status: status -> target in idempotent block
# - Adds audit logging after successful update when force=true
# Creates backup. No regex.

$ErrorActionPreference = "Stop"
function Fail($m){ throw "[FAIL] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$path = "app\api\dispatch\status\route.ts"
if(!(Test-Path $path)){ Fail "Missing: $path (run from repo root)" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $path "$path.bak.$stamp" -Force
Ok "Backup: $path.bak.$stamp"

$txt = Get-Content $path -Raw
$orig = $txt

# 1) Fix the broken reference inside the existing audit block (status -> target)
$bad = 'to_status: status ?? null,'
if($txt.IndexOf($bad) -ge 0){
  $txt = $txt.Replace($bad, 'to_status: target ?? null,')
  Ok "Fixed: to_status uses target (was undefined status)."
} else {
  Ok "No bad to_status reference found (maybe already fixed)."
}

# 2) Ensure we also log force transitions after update (covers cur!=target forced transitions)
# Anchor: right before the final return NextResponse.json({ ... status: target ... })
$anchor = 'return NextResponse.json('
# We'll insert our block just before the LAST return NextResponse.json in POST
$lastReturn = $txt.LastIndexOf($anchor)
if($lastReturn -lt 0){ Fail "Could not find any return NextResponse.json anchor." }

# Avoid double insertion
if($txt.IndexOf('action: "FORCE_STATUS"') -ge 0 -and $txt.IndexOf('meta: { source: "dispatch/status", phase: "post-update" }') -ge 0){
  Ok "Post-update FORCE_STATUS audit already present. Skipping insert."
} else {

  $insert = @"

  // Audit: forced status transitions (post-update; best effort)
  if (force) {
    try {
      await supabase.from("admin_audit_log").insert({
        actor_id: null,
        actor_email: null,
        action: "FORCE_STATUS",
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        from_status: cur ?? null,
        to_status: target ?? null,
        meta: { source: "dispatch/status", phase: "post-update", changed: true, note: body.note ?? null }
      } as any);
    } catch {}
  }

"@

  $txt = $txt.Insert($lastReturn, $insert)
  Ok "Inserted post-update FORCE_STATUS audit block."
}

if($txt -eq $orig){
  Fail "No changes applied (unexpected)."
}

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Wrote: $path"
Ok "Phase 8B patch applied."
