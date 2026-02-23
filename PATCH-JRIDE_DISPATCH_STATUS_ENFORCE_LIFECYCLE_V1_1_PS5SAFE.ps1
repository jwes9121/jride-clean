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

function Replace-OneOrNull([string]$text, [string]$pattern, [string]$replacement){
  $re = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if(-not $re.IsMatch($text)){ return $null }
  return $re.Replace($text, $replacement, 1)
}

# --- Main ---
if(-not (Test-Path -LiteralPath $ProjRoot)){ Fail "[FAIL] ProjRoot not found: $ProjRoot" }
$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path

$target = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if(-not (Test-Path -LiteralPath $target)){ Fail "[FAIL] Missing: $target" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
Ensure-Dir $bakDir
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("route.ts.bak.STATUS_LIFECYCLE_V1_1." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Read-TextUtf8NoBom $target

# No-op if already patched
if($txt -match "JRIDE_LIFECYCLE_ENFORCE_BEGIN"){
  Ok "[OK] Lifecycle enforcement already present. No changes."
  exit 0
}

# 1) Insert helper after NEXT map (same as before)
$injectHelper = @'

/* JRIDE_LIFECYCLE_ENFORCE_BEGIN */
function allowedNextStatuses(fromStatus: string): string[] {
  const f = norm(fromStatus);
  const arr = (NEXT as any)?.[f];
  return Array.isArray(arr) ? arr : [];
}

function isValidTransition(fromStatus: string, toStatus: string): { ok: boolean; reason?: string; allowed?: string[] } {
  const fromS = norm(fromStatus);
  const toS = norm(toStatus);

  if (!toS) return { ok: false, reason: "MISSING_TARGET_STATUS", allowed: allowedNextStatuses(fromS) };

  if (fromS === "completed" || fromS === "cancelled") {
    return { ok: false, reason: "TERMINAL_STATE", allowed: [] };
  }

  if (fromS === toS) return { ok: true };

  const allowed = allowedNextStatuses(fromS);
  if (!allowed.length) return { ok: false, reason: "NO_TRANSITIONS_DEFINED", allowed };

  if (allowed.indexOf(toS) >= 0) return { ok: true };

  return { ok: false, reason: "INVALID_TRANSITION", allowed };
}
/* JRIDE_LIFECYCLE_ENFORCE_END */

'@

$afterNextPattern = "(?s)(const\s+NEXT:\s*Record<string,\s*string\[\]>\s*=\s*\{.*?\n\};\s*\n)"
$txt1 = Replace-OneOrNull $txt $afterNextPattern ('$1' + $injectHelper)
if($txt1 -eq $null){
  Fail "[FAIL] Patch anchor not found: Insert helper after NEXT map"
}

# 2) Insert lifecycle check after booking existence is confirmed
$injectCheck = @'
  // JRIDE_LIFECYCLE_CHECK_BEGIN
  const fromStatus = norm((booking as any)?.status);
  const toStatus = norm(status);

  if (!force) {
    const v = isValidTransition(fromStatus, toStatus);
    if (!v.ok) {
      return jsonErr("INVALID_TRANSITION", "Status transition not allowed", 409, {
        from_status: fromStatus,
        to_status: toStatus,
        allowed_next: v.allowed || [],
        reason: v.reason || "INVALID_TRANSITION",
      });
    }
  }
  // JRIDE_LIFECYCLE_CHECK_END

'@

# Try anchors in order:
# A) after if (!booking) { ... } block
$patA = "(?s)(if\s*\(\s*!booking\s*\)\s*\{.*?\n\s*\}\s*\n)"
$txt2 = Replace-OneOrNull $txt1 $patA ('$1' + $injectCheck)

# B) after 'if (!booking) return ...;' one-liner
if($txt2 -eq $null){
  $patB = "(?s)(if\s*\(\s*!booking\s*\)\s*return\s+.*?;\s*\n)"
  $txt2 = Replace-OneOrNull $txt1 $patB ('$1' + $injectCheck)
}

# C) after 'const booking = ...;' (generic)
if($txt2 -eq $null){
  $patC = "(?s)(const\s+booking\s*=\s*.*?;\s*\n)"
  $txt2 = Replace-OneOrNull $txt1 $patC ('$1' + $injectCheck)
}

if($txt2 -eq $null){
  Fail "[FAIL] Could not locate a booking anchor in POST to inject lifecycle check (no 'booking' patterns matched)."
}

Write-TextUtf8NoBom $target $txt2
Ok "[OK] Patched: app/api/dispatch/status/route.ts (lifecycle enforced V1.1)"

Info "[NEXT] Run: npm.cmd run build"