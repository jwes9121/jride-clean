# FIX-JRIDE_PHASE11C_OPTIONA_SELID_SCOPE.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$RepoRoot = Get-Location
$FileRel  = "app\ride\page.tsx"
$FilePath = Join-Path $RepoRoot $FileRel
if (!(Test-Path $FilePath)) { Fail "File not found: $FilePath (Run from repo root.)" }

$ts  = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FilePath.bak.$ts"
Copy-Item -LiteralPath $FilePath -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $FilePath -Raw

# Anchor: the failing line
$badLine = 'if (selId) setSelectedGeoToId(selId);'
$idx = $txt.IndexOf($badLine)
if ($idx -lt 0) {
  Fail "Anchor not found: missing 'if (selId) setSelectedGeoToId(selId);' line."
}

# Replace with scoped-safe code (compute selId inline)
$replacement = @'
      {
        const _selId = String(((f as any).mapbox_id || (f as any).id || "")).trim();
        if (_selId) setSelectedGeoToId(_selId);
      }
'@

$txt = $txt.Replace($badLine, $replacement)

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched selId scope for to-branch."
Write-Host "[DONE] File: $FileRel"
