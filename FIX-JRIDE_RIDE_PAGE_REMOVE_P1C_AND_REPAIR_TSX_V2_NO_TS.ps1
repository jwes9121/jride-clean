# FIX-JRIDE_RIDE_PAGE_REMOVE_P1C_AND_REPAIR_TSX_V2_NO_TS.ps1
# Removes PHASE P1C blocks + risky JSX attribute injections that commonly break TSX,
# without requiring TypeScript to be installed.
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
function Backup-File($path,$suffix){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$path.$suffix.$ts"
  Copy-Item -Force $path $bak
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path $target)){ Fail "Not found: $target" }

Backup-File $target "pre_fix_remove_p1c"

$t = Read-Utf8NoBom $target
$origLen = $t.Length

# -----------------------------
# 1) Remove whole PHASE P1C blocks (helpers + banner), if present
# -----------------------------
$t = [regex]::Replace(
  $t,
  '(?s)/\*\s*=====\s*PHASE P1C: Action guardrails \(UI-only\)\s*=====\s*\*/.*?/\*\s*=====\s*END PHASE P1C\s*=====\s*\*/\s*',
  '',
  [Text.RegularExpressions.RegexOptions]::IgnoreCase
)

$t = [regex]::Replace(
  $t,
  '(?s)\{\s*/\*\s*=====\s*PHASE P1C: Guardrails banner \(UI-only\)\s*=====\s*\*/\s*\}.*?\{\s*/\*\s*=====\s*END PHASE P1C BANNER\s*=====\s*\*/\s*\}\s*',
  '',
  [Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# -----------------------------
# 2) Remove dangerous injected attributes
# -----------------------------
# Remove data-p1c attributes (submit/clear)
$t = [regex]::Replace($t, '\s+data-p1c="[^"]*"', '', 'IgnoreCase')

# Remove p1c-based disabled/aria-disabled injections
$t = [regex]::Replace($t, '\s+disabled=\{p1cIsActiveTrip\([^\}]*\)\}', '', 'IgnoreCase')
$t = [regex]::Replace($t, '\s+aria-disabled=\{p1cIsActiveTrip\([^\}]*\)\}', '', 'IgnoreCase')

# Revert disabled={busy || p1cIsActiveTrip(...)} to disabled={busy}
$t = [regex]::Replace(
  $t,
  'disabled=\{busy\s*\|\|\s*p1cIsActiveTrip\([^\}]*\)\}',
  'disabled={busy}',
  [Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# Fix any broken pattern "/ data-p1c" (common corruption)
$t = $t.Replace("/ data-p1c", " data-p1c")

# -----------------------------
# 3) Undo allowSubmit patch if it was changed to reference p1c*
# -----------------------------
$t = [regex]::Replace(
  $t,
  'geoOrLocalOk\s*&&\s*!p1cIsActiveTrip\(\s*p1cEffectiveStatus\(\s*liveStatus\s*\)\s*\)\s*;',
  'geoOrLocalOk;',
  [Text.RegularExpressions.RegexOptions]::IgnoreCase
)

# -----------------------------
# 4) Mojibake cleanup (ASCII-safe)
# -----------------------------
$badApos = ([char]0x00E2) + ([char]0x20AC) + ([char]0x2122)
$t = $t -replace [regex]::Escape($badApos), "'"

# -----------------------------
# 5) Minimal sanity: ensure we didn't accidentally delete the main return
# -----------------------------
if($t.IndexOf("return (") -lt 0 -or $t.IndexOf("<main") -lt 0){
  Fail "Sanity check failed: could not find 'return (' or '<main' in output. Aborting write."
}

Backup-File $target "pre_fix_writeback"
Write-Utf8NoBom $target $t

$delta = $origLen - $t.Length
Write-Host "[OK] Wrote cleaned file: $target"
Write-Host "[INFO] Size delta (orig-new): $delta chars"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
