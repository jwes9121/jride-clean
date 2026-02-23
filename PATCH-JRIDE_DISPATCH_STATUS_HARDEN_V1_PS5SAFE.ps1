param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

function Ensure-Dir([string]$p){
  if(-not (Test-Path -LiteralPath $p)){ New-Item -ItemType Directory -Path $p | Out-Null }
}

function Read-TextUtf8NoBom([string]$path){
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF){
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-TextUtf8NoBom([string]$path, [string]$text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

function Replace-One([string]$text, [string]$pattern, [string]$replacement, [string]$label){
  $re = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if(-not $re.IsMatch($text)){ Fail "[FAIL] Patch anchor not found: $label" }
  return $re.Replace($text, $replacement, 1)
}

function Replace-All([string]$text, [string]$pattern, [string]$replacement){
  return [System.Text.RegularExpressions.Regex]::Replace($text, $pattern, $replacement, [System.Text.RegularExpressions.RegexOptions]::Singleline)
}

# --- Main ---
if(-not (Test-Path -LiteralPath $ProjRoot)){ Fail "[FAIL] ProjRoot not found: $ProjRoot" }
$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path

$target = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if(-not (Test-Path -LiteralPath $target)){ Fail "[FAIL] Missing: $target" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
Ensure-Dir $bakDir
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("route.ts.bak.DISPATCH_STATUS_HARDEN_V1." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Read-TextUtf8NoBom $target

# 1) Remove duplicate GET gate block (JRIDE_ADMIN_SECRET_GATE_BEGIN/END)
$txt2 = Replace-One `
  $txt `
  "(?s)\n\s*//\s*JRIDE_ADMIN_SECRET_GATE_BEGIN.*?//\s*JRIDE_ADMIN_SECRET_GATE_END\s*\n" `
  "`n" `
  "Remove duplicate GET auth gate block"

# 2) Standardize secret header check in GET + POST
# Replace: const gotSecret = String(req.headers.get("x-jride-admin-secret") || "").trim();
$txt3 = Replace-All `
  $txt2 `
  "const\s+gotSecret\s*=\s*String\(\s*req\.headers\.get\(""x-jride-admin-secret""\)\s*\|\|\s*""""\s*\)\.trim\(\);\s*" `
  "const gotSecret = String(req.headers.get(""x-jride-admin-secret"") || req.headers.get(""x-admin-secret"") || """").trim();`n"

# 3) Remove globalThis warnings stabilization block in POST and keep only local warnings
# Replace the block that sets globalThis.__jrideWarnings
$txt4 = Replace-One `
  $txt3 `
  "(?s)export\s+async\s+function\s+POST\s*\(req:\s*Request\)\s*\{\s*\n\s*//\s*=====\s*JRIDE_WARNINGS_STABILIZE\s*\(AUTO\)\s*=====\s*\n\s*let\s+warnings:\s*string\[\]\s*=\s*\[\];\s*\n\s*\(globalThis\s+as\s+any\)\.__jrideWarnings\s*=\s*warnings;\s*\n" `
  "export async function POST(req: Request) {`n  let warnings: string[] = [];`n" `
  "Remove globalThis warnings stabilization"

# 4) Fix STEP5E: use passed warnings array; remove accidental redeclare; replace globalThis pushes
# Remove the accidental 'const warnings: string[] = [];' that appears inside STEP5E blocks
$txt5 = Replace-All $txt4 "(?m)^\s*const\s+warnings:\s*string\[\]\s*=\s*\[\];\s*$\n" ""

# Replace all pushes to globalThis with pushes to local warnings param (within helpers)
$txt6 = Replace-All $txt5 "\(\(globalThis\s+as\s+any\)\.__jrideWarnings\s*\?\?=\s*\[\]\)\.push" "warnings.push"
$txt7 = Replace-All $txt6 "\(\(globalThis\s+as\s+any\)\.__jrideWarnings\s*\?\?\s*\[\]\)\.length" "warnings.length"
$txt8 = Replace-All $txt7 "\(\(globalThis\s+as\s+any\)\.__jrideWarnings\s*\?\?\s*\[\]\)\.join\("" ; ""\)" "warnings.join(""; "")"

# The file has: return ((globalThis as any).__jrideWarnings ?? []).length ? { warning: ((globalThis as any).__jrideWarnings ?? []).join("; ") } : {};
# Ensure it becomes: return warnings.length ? { warning: warnings.join("; ") } : {};
$txt9 = Replace-All $txt8 "\{\s*warning:\s*warnings\.join\("" ; ""\)\s*\}" "{ warning: warnings.join(""; "") }"

# 5) Update bestEffortWalletSyncOnComplete signature to accept warnings and pass warnings into STEP5E
# Change function signature: (supabase, booking) -> (supabase, booking, warnings)
$txt10 = Replace-One `
  $txt9 `
  "(?s)async\s+function\s+bestEffortWalletSyncOnComplete\(\s*\n\s*supabase:\s*ReturnType<typeof\s+createClient>,\s*\n\s*booking:\s*any\s*\n\s*\):\s*Promise<\{ warning\?:\s*string\s*\}>\s*\{" `
  "async function bestEffortWalletSyncOnComplete(`n  supabase: ReturnType<typeof createClient>,`n  booking: any,`n  warnings: string[]`n): Promise<{ warning?: string }> {" `
  "Add warnings param to bestEffortWalletSyncOnComplete"

# Update STEP5E call site inside wallet sync: step5eBestEffortEmergencyWalletSplit(..., [])
$txt11 = Replace-All $txt10 "step5eBestEffortEmergencyWalletSplit\(supabase,\s*booking,\s*\[\]\)" "step5eBestEffortEmergencyWalletSplit(supabase, booking, warnings)"

# 6) Update call site in POST: bestEffortWalletSyncOnComplete(supabase, updatedBooking) -> include warnings
$txt12 = Replace-All $txt11 "bestEffortWalletSyncOnComplete\(supabase,\s*updatedBooking\)" "bestEffortWalletSyncOnComplete(supabase, updatedBooking, warnings)"

# 7) Update STEP5E_CALL_SITE already passes [] somewhere else (safety)
$txt13 = Replace-All $txt12 "step5eBestEffortEmergencyWalletSplit\(supabase,\s*booking,\s*\[\]\)" "step5eBestEffortEmergencyWalletSplit(supabase, booking, warnings)"

# 8) Ensure the secret header check in POST also includes x-admin-secret (if present as different pattern)
$txt14 = Replace-All `
  $txt13 `
  "const\s+gotSecret\s*=\s*String\(\s*req\.headers\.get\(""x-jride-admin-secret""\)\s*\|\|\s*""""\s*\)\.trim\(\);\s*" `
  "const gotSecret = String(req.headers.get(""x-jride-admin-secret"") || req.headers.get(""x-admin-secret"") || """").trim();`n"

Write-TextUtf8NoBom $target $txt14
Ok "[OK] Patched: app/api/dispatch/status/route.ts"

Info "[NEXT] Run: npm.cmd run build"