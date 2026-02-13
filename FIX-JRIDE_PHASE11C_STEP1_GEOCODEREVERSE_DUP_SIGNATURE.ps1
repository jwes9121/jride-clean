# FIX-JRIDE_PHASE11C_STEP1_GEOCODEREVERSE_DUP_SIGNATURE.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$RepoRoot = Get-Location
$FileRel = "app\ride\page.tsx"
$FilePath = Join-Path $RepoRoot $FileRel

if (!(Test-Path $FilePath)) { Fail "File not found: $FilePath  (Run this from your repo root.)" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FilePath.bak.$ts"
Copy-Item -LiteralPath $FilePath -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $FilePath -Raw

# Anchor: the exact broken signature fragment from your error
$broken = 'async function geocodeReverse(lng: number, lat: number): Promise<string> {(lng: number, lat: number): Promise<string> {'
if ($txt.IndexOf($broken) -lt 0) {
  # Also handle a common variant with whitespace/newlines
  $re = 'async\s+function\s+geocodeReverse\(lng:\s*number,\s*lat:\s*number\):\s*Promise<string>\s*\{\s*\(lng:\s*number,\s*lat:\s*number\):\s*Promise<string>\s*\{'
  if (-not [regex]::IsMatch($txt, $re)) {
    Fail "Broken geocodeReverse signature not found. Paste lines ~240-275 from app/ride/page.tsx."
  }
  $txt = [regex]::Replace(
    $txt,
    $re,
    'async function geocodeReverse(lng: number, lat: number): Promise<string> {',
    1
  )
  Write-Host "[OK] Fixed geocodeReverse signature (regex variant)."
} else {
  $txt = $txt.Replace($broken, 'async function geocodeReverse(lng: number, lat: number): Promise<string> {')
  Write-Host "[OK] Fixed geocodeReverse signature (exact match)."
}

# Safety anchor: ensure we still have a valid function header now
if ($txt.IndexOf('async function geocodeReverse(lng: number, lat: number): Promise<string> {') -lt 0) {
  Fail "Post-check failed: geocodeReverse header missing after patch."
}

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $FileRel"
