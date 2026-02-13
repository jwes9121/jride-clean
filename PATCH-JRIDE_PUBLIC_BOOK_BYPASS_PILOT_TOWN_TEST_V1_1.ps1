# PATCH-JRIDE_PUBLIC_BOOK_BYPASS_PILOT_TOWN_TEST_V1_1.ps1
# TEST-ONLY bypass for PILOT_TOWN_DISABLED in app/api/public/passenger/book/route.ts
# Triggers only when:
#   x-jride-test: 1  AND  x-jride-bypass-location: 1
# Safe: normal users won't send these headers.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

$RepoRoot = (Get-Location).Path
$target = Join-Path $RepoRoot "app\api\public\passenger\book\route.ts"
if (-not (Test-Path -LiteralPath $target)) {
  Die "[FAIL] Missing: app\api\public\passenger\book\route.ts (run from repo root)"
}

Ok ("[OK] Target: " + $target)

# Backup
$BakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $BakDir | Out-Null
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $BakDir ("public-passenger-book.route.ts.bak." + $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: " + $bak)

$lines = Get-Content -LiteralPath $target -Encoding UTF8
if (-not $lines -or $lines.Count -eq 0) { Die "[FAIL] File read empty." }

# 1) Inject bypass helper just after POST function opening (idempotent)
if (($lines -join "`n") -notmatch 'JRIDE_TEST_BYPASS_PILOT_TOWN') {

  $postLine = -1
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'export\s+async\s+function\s+POST\s*\(') { $postLine = $i; break }
  }
  if ($postLine -lt 0) { Die "[FAIL] Could not find export async function POST(...)" }

  # Find the first '{' after the POST signature (could be on same line or next lines)
  $openIdx = -1
  for ($i=$postLine; $i -lt [Math]::Min($postLine+8, $lines.Count); $i++) {
    if ($lines[$i].Contains("{")) { $openIdx = $i; break }
  }
  if ($openIdx -lt 0) { Die "[FAIL] Could not find POST opening brace near signature." }

  # Determine indentation for injected code
  $indent = "  "
  if ($openIdx + 1 -lt $lines.Count) {
    $m = [regex]::Match($lines[$openIdx+1], '^\s+')
    if ($m.Success) { $indent = $m.Value }
  }

  $inject = @(
    ($indent + "// JRIDE_TEST_BYPASS_PILOT_TOWN")
    ($indent + "// Allows test bookings to bypass pilot-town restriction ONLY when explicit test headers are present.")
    ($indent + "const hx = (k: string) => {")
    ($indent + "  try { return String((req as any)?.headers?.get?.(k) || """").trim(); } catch { return """"; }")
    ($indent + "};")
    ($indent + "const jrideTestBypass = (hx(""x-jride-test"") === ""1"" && hx(""x-jride-bypass-location"") === ""1"");")
    ($indent + "// JRIDE_TEST_BYPASS_PILOT_TOWN_END")
    ""
  )

  $insertAt = $openIdx + 1
  $lines = @(
    $lines[0..($insertAt-1)]
    $inject
    $lines[$insertAt..($lines.Count-1)]
  )

  Ok "[OK] Injected jrideTestBypass helper after POST opening."
} else {
  Warn "[WARN] Bypass helper already present; skipping inject."
}

# 2) Wrap the PILOT_TOWN_DISABLED return so it only triggers when NOT test bypass.
# Find the line containing PILOT_TOWN_DISABLED, then find the nearest preceding "return NextResponse.json" line.
$idxCode = -1
for ($i=0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match 'PILOT_TOWN_DISABLED') { $idxCode = $i; break }
}
if ($idxCode -lt 0) { Die "[FAIL] Could not find PILOT_TOWN_DISABLED in file." }

# Find start of the return block
$startReturn = -1
for ($i=$idxCode; $i -ge 0; $i--) {
  if ($lines[$i] -match 'return\s+NextResponse\.json') { $startReturn = $i; break }
}
if ($startReturn -lt 0) { Die "[FAIL] Could not locate return NextResponse.json block for PILOT_TOWN_DISABLED." }

# Find end of that return statement (first line after start that ends with ');' or contains ');')
$endReturn = -1
for ($i=$startReturn; $i -lt [Math]::Min($startReturn+30, $lines.Count); $i++) {
  if ($lines[$i] -match '\);\s*$' -or $lines[$i] -match '\);\s*//') { $endReturn = $i; break }
  if ($lines[$i].Contains(");")) { $endReturn = $i; break }
}
if ($endReturn -lt 0) { Die "[FAIL] Could not find end of NextResponse.json(...) return statement." }

# Check if already wrapped
$alreadyWrapped = $false
for ($i=[Math]::Max(0,$startReturn-3); $i -le $startReturn; $i++) {
  if ($lines[$i] -match 'if\s*\(\s*!jrideTestBypass\s*\)') { $alreadyWrapped = $true; break }
}
if (-not $alreadyWrapped) {
  # Determine indentation from the return line
  $indent = "  "
  $m = [regex]::Match($lines[$startReturn], '^\s+')
  if ($m.Success) { $indent = $m.Value }

  $open = $indent + "if (!jrideTestBypass) {"
  $close = $indent + "}"

  # Insert open before return, close after endReturn
  $lines = @(
    $lines[0..($startReturn-1)]
    $open
    $lines[$startReturn..$endReturn]
    $close
    $lines[($endReturn+1)..($lines.Count-1)]
  )

  Ok "[OK] Wrapped PILOT_TOWN_DISABLED return with if (!jrideTestBypass) guard."
} else {
  Warn "[WARN] PILOT_TOWN_DISABLED return already guarded; skipping."
}

Set-Content -LiteralPath $target -Value $lines -Encoding UTF8
Ok "[OK] Wrote patched file."
Ok "== DONE =="
