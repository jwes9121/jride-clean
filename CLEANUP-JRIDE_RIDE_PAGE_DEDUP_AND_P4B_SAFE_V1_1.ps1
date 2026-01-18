# CLEANUP-JRIDE_RIDE_PAGE_DEDUP_AND_P4B_SAFE_V1_1.ps1
# ASCII-only | UTF8 NO BOM
# Fixes:
# 1) Remove nested p3ExplainBlock() injection inside p1RenderStepper()
# 2) Remove nested PHASE P1 helper block injected inside jridePhase2dNormalizeItems()
# 3) Rewrite p4PickupDistanceFee() to not depend on p4Num() and keep ASCII comments

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function TS(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadT($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object Text.UTF8Encoding($false); [IO.File]::WriteAllText($p,$t,$enc) }

$target = "app\ride\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

$bak = "$target.bak.$(TS)"
Copy-Item -Force $target $bak
Write-Host "[OK] Backup: $bak"

$txt = ReadT $target
$orig = $txt

# ------------------------------------------------------------
# 1) Remove nested P3 helper injection inside p1RenderStepper()
# ------------------------------------------------------------
$rxNestedP3 = [regex]::new(
  '(function\s+p1RenderStepper\s*\(\s*stRaw:\s*any\s*\)\s*\{\s*)/\*\s*=====\s*PHASE\s*P3:[\s\S]*?/\*\s*=====\s*END\s*PHASE\s*P3\s*HELPERS\s*=====\s*\*/\s*',
  'Singleline'
)
if($rxNestedP3.IsMatch($txt)){
  $txt = $rxNestedP3.Replace($txt, '$1' + "`r`n", 1)
  Write-Host "[OK] Removed nested p3ExplainBlock() injection inside p1RenderStepper()."
}

# Fix case where END marker and "const st =" are on the same line
$txt = [regex]::Replace(
  $txt,
  '(/\*\s*=====\s*END\s*PHASE\s*P3\s*HELPERS\s*=====\s*\*/)\s+const\s+st\s+=',
  "`$1`r`n  const st =",
  'Singleline'
)

# ------------------------------------------------------------
# 2) Remove nested PHASE P1 helper block inside jridePhase2dNormalizeItems()
# ------------------------------------------------------------
$rxP1InsideNormalize = [regex]::new(
  '(\r?\n\s*)//\s*=====\s*PHASE\s*P1:[\s\S]*?//\s*=====\s*END\s*PHASE\s*P1\s*=====\s*(\r?\n)',
  'Singleline'
)
if($rxP1InsideNormalize.IsMatch($txt)){
  $txt = $rxP1InsideNormalize.Replace($txt, "`r`n", 1)
  Write-Host "[OK] Removed nested PHASE P1 helper block inside jridePhase2dNormalizeItems()."
}

# ------------------------------------------------------------
# 3) Rewrite p4PickupDistanceFee() to be self-contained and ASCII
# ------------------------------------------------------------
$rxP4 = [regex]::new(
  'function\s+p4PickupDistanceFee\s*\(\s*driverToPickupKmAny:\s*any\s*\)\s*:\s*number\s*\{[\s\S]*?\r?\n\}',
  'Singleline'
)

$p4Replacement = @'
function p4PickupDistanceFee(driverToPickupKmAny: any): number {
  const km0 = (typeof driverToPickupKmAny === "number") ? driverToPickupKmAny : Number(driverToPickupKmAny);
  const km = Number.isFinite(km0) ? km0 : null;

  // Pickup Distance Fee rule (FINAL):
  // Free pickup: up to 1.5 km
  // If driver->pickup distance > 1.5 km:
  // Base pickup fee: PHP 20
  // PHP 10 per additional 0.5 km, rounded up
  if (km == null) return 0;
  if (km <= 1.5) return 0;

  const base = 20;
  const perHalfKm = 10;

  const over = km - 1.5;
  const steps = Math.ceil(over / 0.5);

  return base + steps * perHalfKm;
}
'@

if($rxP4.IsMatch($txt)){
  $txt = $rxP4.Replace($txt, $p4Replacement, 1)
  Write-Host "[OK] Rewrote p4PickupDistanceFee() to be self-contained (no p4Num) and ASCII."
} else {
  Write-Host "[WARN] p4PickupDistanceFee() pattern not found (skipped)."
}

if($txt -eq $orig){ Fail "No changes applied." }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Cleaned: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
