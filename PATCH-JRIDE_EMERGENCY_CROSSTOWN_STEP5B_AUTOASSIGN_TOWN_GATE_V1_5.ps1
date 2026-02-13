# PATCH-JRIDE_EMERGENCY_CROSSTOWN_STEP5B_AUTOASSIGN_TOWN_GATE_V1_5.ps1
# STEP 5B FIX ONLY:
# - Ensure `filteredCandidates` is declared in the SAME scope as the distance loop.
# - Injects right after: `let bestDistance = Infinity;`
# - Does NOT touch Mapbox, pricing, or other behaviors.

$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Require-Anchor($txt, $needle, $path) {
  if ($txt.IndexOf($needle) -lt 0) {
    throw ("Anchor not found in {0}`n---needle---`n{1}`n------------" -f $path, $needle)
  }
}

$root = (Get-Location).Path
$path = Join-Path $root "app\api\dispatch\auto-assign\route.ts"
Backup-File $path

$txt = Get-Content -LiteralPath $path -Raw

$needle = "let bestDistance = Infinity;"
Require-Anchor $txt $needle $path

# If we already declared filteredCandidates near the loop, skip
if ($txt -match "let\s+filteredCandidates\s*=\s*candidates\s*;") {
  Write-Host "[SKIP] Declaration already exists somewhere; will still ensure it exists after bestDistance."
}

$inject = @'
    // ===== STEP 5B: ensure filteredCandidates exists in loop scope =====
    let filteredCandidates = candidates;
    // ===== END STEP 5B =====

'@

# Insert ONLY if it’s not already immediately after bestDistance
$pos = $txt.IndexOf($needle)
$posEnd = $pos + $needle.Length
$after = $txt.Substring($posEnd)

if ($after.TrimStart().StartsWith("// ===== STEP 5B: ensure filteredCandidates exists in loop scope =====")) {
  Write-Host "[SKIP] Loop-scope declaration already present after bestDistance"
} else {
  $before = $txt.Substring(0, $posEnd)
  $txt = $before + "`r`n" + $inject + $after
  Write-Host "[OK] Injected loop-scope declaration after bestDistance"
}

# Write back UTF8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt, $utf8NoBom)

Write-Host "[DONE] Patched: $path"
Write-Host ""
Write-Host "NEXT: npm run build"
