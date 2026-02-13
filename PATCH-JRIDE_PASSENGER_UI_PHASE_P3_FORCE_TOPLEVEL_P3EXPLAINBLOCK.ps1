# PATCH-JRIDE_PASSENGER_UI_PHASE_P3_FORCE_TOPLEVEL_P3EXPLAINBLOCK.ps1
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES
# Fix: Ensure p3ExplainBlock exists at TOP-LEVEL module scope (visible to JSX)
# Patches ONLY: app\ride\page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Read-Utf8NoBom($path){
  if(!(Test-Path $path)){ Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
}
function Write-Utf8NoBom($path,$text){
  [System.IO.File]::WriteAllText($path,$text,[System.Text.UTF8Encoding]::new($false))
}
function Backup-File($path){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$path.bak.$ts"
  Copy-Item -Force $path $bak
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path $target)){ Fail "Not found: $target" }

Backup-File $target
$t0 = Read-Utf8NoBom $target
$t  = $t0

$marker = "/* ===== PHASE P3 TOPLEVEL EXPLAIN BLOCK (AUTO) ===== */"
if($t.IndexOf($marker) -ge 0){
  Write-Host "[OK] PHASE P3 top-level marker already present (skip)"
  Write-Utf8NoBom $target $t
  Write-Host "[OK] Wrote: $target"
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

# Determine insertion point: after imports (or after 'use client' if present), near top of file
$scanLimit = [Math]::Min($t.Length, 8000)
$head = $t.Substring(0, $scanLimit)

$lastImportPos = $head.LastIndexOf("import ")
$useClientPos = $head.IndexOf('"use client"')
if($useClientPos -lt 0){ $useClientPos = $head.IndexOf("'use client'") }

if($lastImportPos -ge 0){
  $afterLastImportLine = $head.IndexOf("`n", $lastImportPos)
  if($afterLastImportLine -lt 0){ $afterLastImportLine = $lastImportPos }
  $doubleNl = $head.IndexOf("`n`n", $afterLastImportLine)
  if($doubleNl -lt 0){
    $insertPos = $afterLastImportLine + 1
  } else {
    $insertPos = $doubleNl + 2
  }
} elseif($useClientPos -ge 0) {
  $lineEnd = $head.IndexOf("`n", $useClientPos)
  if($lineEnd -lt 0){ $lineEnd = $useClientPos + 12 }
  $insertPos = $lineEnd + 1
} else {
  $insertPos = 0
}

$block = @'
/* ===== PHASE P3 TOPLEVEL EXPLAIN BLOCK (AUTO) ===== */
function p3ExplainBlock(resultText: any): null | { title: string; body: string; next: string } {
  const t = String(resultText || "").toUpperCase();
  if (!t) return null;

  // Try to detect common block reasons from existing strings/codes without backend changes
  if (t.includes("VERIFY") || t.includes("VERIFICATION") || t.includes("UNVERIFIED")) {
    return {
      title: "Account verification required",
      body: "Please verify your account before booking a ride.",
      next: "Verify your account to continue."
    };
  }
  if (t.includes("NIGHT")) {
    return {
      title: "Booking unavailable at this time",
      body: "Bookings may be limited during night hours.",
      next: "Please try again later."
    };
  }
  if (t.includes("GEO") || t.includes("AREA") || t.includes("OUTSIDE") || t.includes("SERVICE AREA")) {
    return {
      title: "Service not available in your area",
      body: "This service is currently limited to supported locations.",
      next: "Move to a supported area and try again."
    };
  }
  if (t.includes("BLOCK") || t.includes("UNAVAILABLE")) {
    return {
      title: "Booking temporarily unavailable",
      body: "We’re unable to process bookings right now.",
      next: "Please try again later."
    };
  }
  return null;
}
/* ===== END PHASE P3 TOPLEVEL EXPLAIN BLOCK (AUTO) ===== */

'@

$t = $t.Substring(0, $insertPos) + $block + "`n" + $t.Substring($insertPos)

Write-Utf8NoBom $target $t
Write-Host "[OK] Inserted top-level p3ExplainBlock"
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
