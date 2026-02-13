# PATCH-JRIDE_11C_CAN_BOOK_AUTHORITATIVE_VERIFY_ONLY_UTF8NOBOM_V1.ps1
# ASCII-only. Anchor-based. UTF8 NO BOM. Makes can-book authoritative: allowed only if verified.
# Does NOT touch dispatch. Only edits can-book route.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Timestamp(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }

function ReadText($path){
  if(!(Test-Path -LiteralPath $path)){ Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path)
}
function WriteUtf8NoBom($path,$text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path,$text,$enc)
}

$root = (Get-Location).Path

# Adjust this path ONLY if your can-book route lives somewhere else
$target = Join-Path $root "app\api\public\passenger\can-book\route.ts"
if(!(Test-Path -LiteralPath $target)){
  Fail "Target not found: $target`nIf your file is in a different path, tell me the exact repo path."
}

$ts = Timestamp
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = ReadText $target
$orig = $txt

# ------------------------------------------------------------
# 0) Remove UTF-8 BOM if present (invisible char at file start)
# ------------------------------------------------------------
if($txt.Length -gt 0 -and [int][char]$txt[0] -eq 65279){
  $txt = $txt.Substring(1)
  Write-Host "[OK] Removed UTF-8 BOM."
}

# ------------------------------------------------------------
# 1) Replace the night-gate-only enforcement with authoritative verification
#    Anchor: the existing block:
#      if (nightGate && !v.verified) { ... }
# ------------------------------------------------------------
$nightBlockPattern = '(?s)\s*if\s*\(\s*nightGate\s*&&\s*!v\.verified\s*\)\s*\{\s*return\s+NextResponse\.json\(\s*\{.*?\}\s*,\s*\{\s*status:\s*403\s*\}\s*\)\s*;\s*\}\s*'
if(-not ([Regex]::IsMatch($txt, $nightBlockPattern))){
  Fail "ANCHOR NOT FOUND: could not locate the existing nightGate && !v.verified block in POST()."
}

$replacement = @'
  // Authoritative verification gate:
  // - If not verified, booking is blocked at all times.
  // - Night gate just changes the message/code (still blocked when unverified).
  if (!v.verified) {
    const code = nightGate ? "NIGHT_GATE_UNVERIFIED" : "VERIFICATION_REQUIRED";
    const message = nightGate
      ? "Booking is restricted from 8PM to 5AM unless verified."
      : "Please verify your passenger account before booking.";

    return NextResponse.json(
      {
        env: jrideEnvEcho(),
        ok: false,
        allowed: false,
        code,
        message,
        nightGate: !!nightGate,
        window: "20:00-05:00 Asia/Manila",
        verified: false,
        verification_source: v.source,
        verification_note: v.note,
        verification_status: v.status,
        verification_raw_status: v.raw_status
      },
      { status: 403 }
    );
  }

'@

$txt = [Regex]::Replace($txt, $nightBlockPattern, "`r`n" + $replacement, 1)
Write-Host "[OK] Replaced night-gate-only enforcement with authoritative verification gate."

# ------------------------------------------------------------
# 2) Ensure allowed=true response is still returned only after wallet checks etc.
#    Your existing code already returns allowed:true at the end; since we now
#    early-return when unverified, allowed:true only happens when verified.
# ------------------------------------------------------------
# Optional: ensure response includes allowed:true (already does in your file).
if($txt -notmatch 'allowed:\s*true'){
  Fail "Sanity check failed: allowed:true not found in POST success response."
}

# ------------------------------------------------------------
# 3) Write back as UTF-8 NO BOM
# ------------------------------------------------------------
if($txt -eq $orig){
  Fail "No changes made (unexpected). Aborting without write."
}

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
