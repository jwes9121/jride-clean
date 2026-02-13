# PATCH-JRIDE_PHASE13E2_BACKEND_PILOT_TOWN_GATE.ps1
# Phase 13-E2: Backend (un-bypassable) pilot town gate
# File: app/api/public/passenger/book/route.ts
# One file only. No DB assumptions.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\api\public\passenger\book\route.ts"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path`nRun from repo root." }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -LiteralPath $path -Raw

# Idempotency
if ($txt -match "PHASE13-E2_BACKEND_PILOT_TOWN_GATE") {
  Info "Pilot town backend gate already present. No change."
  exit 0
}

# Anchor after body parse inside POST()
# Your route already parses body safely earlier; we hook immediately after that line.
$bodyAnchor = '(?m)^\s*const\s+body\s*=\s*\(await\s+req\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\)\)\s*as\s*\w+\s*;\s*$'
if ($txt -notmatch $bodyAnchor) {
  Fail "Body parse anchor not found. Paste the POST() body parse line."
}

$insert = @'
  // PHASE13-E2_BACKEND_PILOT_TOWN_GATE
  // Enforce pilot pickup towns (UI + backend parity)
  const PILOT_TOWNS = ["Lagawe", "Hingyon", "Banaue"] as const;
  const pickupTown = String((body as any)?.town || "").trim();
  const pilotTownAllowed = PILOT_TOWNS.includes(pickupTown as any);

  if (!pilotTownAllowed) {
    return NextResponse.json(
      {
        ok: false,
        code: "PILOT_TOWN_DISABLED",
        message: "Pickup in Kiangan/Lamut is temporarily unavailable during pilot.",
      },
      { status: 403 }
    );
  }

'@

$txt = [regex]::Replace($txt, $bodyAnchor, '$0' + "`r`n" + $insert, 1)
Ok "Inserted backend pilot town gate."

Set-Content -LiteralPath $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Ok "Phase 13-E2 backend pilot town gate applied."
