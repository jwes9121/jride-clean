# PATCH-TAKEOUT-EXPRESS-A2-PERSIST-BOOKINGS.ps1
# Step A2 (FOUNDATION): Persist takeout_service_level into bookings insert payload
# Robust for:
#  - .insert({ ... })
#  - .insert([ { ... } ])
#  - .insert(payloadVar) where payloadVar is defined as const payloadVar = { ... }
# Safe: creates backup, refuses double patch, touches ONE FILE ONLY.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$repo = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $repo "app\api\dispatch\bookings\route.ts"

if (!(Test-Path -LiteralPath $file)) {
  Fail "Missing target file: $file"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item -LiteralPath $file "$file.bak.$stamp" -Force
Write-Host "[OK] Backup created: $file.bak.$stamp" -ForegroundColor Green

$txt = Get-Content -LiteralPath $file -Raw

if ($txt -match '\btakeout_service_level\b') {
  Fail "Patch already applied: takeout_service_level already present in $file"
}

# Must have bookings insert
if ($txt -notmatch '\.from\("bookings"\)') { Fail "Sanity failed: .from(""bookings"") not found in $file" }
if ($txt -notmatch '\.insert\s*\(')       { Fail "Sanity failed: .insert( not found in $file" }

# Find bookings insert call (multiline-safe)
$rx = [regex]'(?s)\.from\("bookings"\)\s*(?:\.\s*\w+\s*\([^)]*\)\s*)*?\.\s*insert\s*\(\s*'
$m = $rx.Match($txt)
if (-not $m.Success) {
  Fail "Could not locate the bookings .insert(...) chain in $file"
}

$insertArgStart = $m.Index + $m.Length
$tail = $txt.Substring($insertArgStart)

# The expression we inject into the object literal
# - Only set for TAKEOUT; otherwise null.
$injectLine = @"
`r`n    takeout_service_level: (String(((body as any)?.service_type ?? (body as any)?.trip_type ?? "")).toLowerCase() === "takeout")
      ? (((body as any)?.takeout_service_level ?? "regular"))
      : null,
"@

function Inject-AfterBrace([string]$s, [int]$absPosAfterOpenBrace) {
  return $s.Insert($absPosAfterOpenBrace, $injectLine)
}

# Case 1: insert({ ... })
if ($tail -match '^\{') {
  $absPos = $insertArgStart + 1 # right after "{"
  $txt2 = Inject-AfterBrace $txt $absPos
  Set-Content -LiteralPath $file -Value $txt2 -Encoding UTF8
  Write-Host "[DONE] Injected takeout_service_level into inline insert({ ... })" -ForegroundColor Cyan
  exit 0
}

# Case 2: insert([ { ... } ])
if ($tail -match '^\[\s*\{') {
  $idx = $tail.IndexOf("{")
  if ($idx -lt 0) { Fail "Unexpected: insert([ ... ]) but could not find '{' to inject into." }
  $absPos = $insertArgStart + $idx + 1
  $txt2 = Inject-AfterBrace $txt $absPos
  Set-Content -LiteralPath $file -Value $txt2 -Encoding UTF8
  Write-Host "[DONE] Injected takeout_service_level into insert([ { ... } ])" -ForegroundColor Cyan
  exit 0
}

# Case 3: insert(payloadVar)
$mv = [regex]::Match($tail, '^(?<v>[A-Za-z_][A-Za-z0-9_]*)')
if (-not $mv.Success) {
  Fail "Insert argument is not an object/array/identifier. Cannot patch safely."
}

$varName = $mv.Groups["v"].Value

# Find: const payloadVar = {
$rxDef = [regex]("(?s)\bconst\s+$([regex]::Escape($varName))\s*=\s*\{")
$md = $rxDef.Match($txt)
if (-not $md.Success) {
  Fail "Found insert($varName) but could not find: const $varName = { ... }"
}

$absPos = $md.Index + $md.Length # right after "{"
$txt2 = Inject-AfterBrace $txt $absPos
Set-Content -LiteralPath $file -Value $txt2 -Encoding UTF8

Write-Host "[DONE] Injected takeout_service_level into payload var '$varName'" -ForegroundColor Cyan
Write-Host "File patched: $file" -ForegroundColor Green
