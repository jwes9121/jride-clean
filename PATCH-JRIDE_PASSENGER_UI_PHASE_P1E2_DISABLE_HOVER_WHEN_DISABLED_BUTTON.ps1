# PATCH-JRIDE_PASSENGER_UI_PHASE_P1E2_DISABLE_HOVER_WHEN_DISABLED_BUTTON.ps1
# PHASE P1E.2 (UI-only): prevent hover background change when Button is disabled
# - Adds disabled:hover:bg-* per variant to match the base bg
# - No logic / behavior changes
# Target: components\ui\button.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Read-Utf8NoBom($p){
  if(!(Test-Path $p)){ Fail "Missing file: $p" }
  [System.IO.File]::ReadAllText($p,[System.Text.UTF8Encoding]::new($false))
}
function Write-Utf8NoBom($p,$t){
  [System.IO.File]::WriteAllText($p,$t,[System.Text.UTF8Encoding]::new($false))
}
function Backup($p){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$p.bak.$ts"
  Copy-Item -Force $p $bak
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$targetRel = "components\ui\button.tsx"
$target = Join-Path $root $targetRel
if(!(Test-Path $target)){ Fail "Not found: $targetRel" }

Backup $target
$t = Read-Utf8NoBom $target

# Idempotency
if($t -match "PHASE P1E\.2 DISABLED HOVER LOCK"){
  Write-Host "[OK] P1E.2 already applied (skip)"
  Write-Utf8NoBom $target $t
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

# If any disabled:hover:bg- is already present, we assume patched
if($t -match "disabled:hover:bg-"){
  $t = "/* PHASE P1E.2 DISABLED HOVER LOCK (UI-only): already present */`n" + $t
  Write-Utf8NoBom $target $t
  Write-Host "[OK] disabled:hover:bg-* already present (skip)."
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

function Replace-Once([string]$text, [string]$from, [string]$to){
  $pos = $text.IndexOf($from)
  if($pos -lt 0){ Fail "Anchor not found for Replace-Once: $from" }
  return $text.Substring(0,$pos) + $to + $text.Substring($pos + $from.Length)
}

# Patch each variant line by inserting disabled:hover:bg-* right after hover:bg-*
# default: bg-blue-600 ... hover:bg-blue-700  -> add disabled:hover:bg-blue-600
$t = Replace-Once $t `
  'default: "bg-blue-600 text-white hover:bg-blue-700",' `
  'default: "bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600 /* PHASE P1E.2 DISABLED HOVER LOCK */",'

# outline: bg-white ... hover:bg-gray-50 -> disabled:hover:bg-white
$t = Replace-Once $t `
  'outline: "border bg-white hover:bg-gray-50",' `
  'outline: "border bg-white hover:bg-gray-50 disabled:hover:bg-white",'

# ghost: bg-transparent ... hover:bg-gray-50 -> disabled:hover:bg-transparent
$t = Replace-Once $t `
  'ghost: "bg-transparent hover:bg-gray-50",' `
  'ghost: "bg-transparent hover:bg-gray-50 disabled:hover:bg-transparent",'

# destructive: bg-red-600 ... hover:bg-red-700 -> disabled:hover:bg-red-600
$t = Replace-Once $t `
  'destructive: "bg-red-600 text-white hover:bg-red-700",' `
  'destructive: "bg-red-600 text-white hover:bg-red-700 disabled:hover:bg-red-600",'

# secondary: bg-gray-100 ... hover:bg-gray-200 -> disabled:hover:bg-gray-100
$t = Replace-Once $t `
  'secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",' `
  'secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200 disabled:hover:bg-gray-100",'

# Add a header marker (safe)
$t = "/* PHASE P1E.2 DISABLED HOVER LOCK (UI-only): keep disabled buttons from changing bg on hover */`n" + $t

Write-Utf8NoBom $target $t
Write-Host "[OK] Patched: $targetRel"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
