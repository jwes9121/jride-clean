# PATCH-JRIDE_PHASE12B_BACKEND_CAPABILITY_PROBE_UI_ONLY.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx
# Adds read-only debug lines to Result output after booking success.
# Does NOT change booking payload.

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

# Anchors
$anchor = 'setResult(lines.join("\n"));'
if ($txt.IndexOf($anchor) -lt 0) { Fail "Anchor not found: $anchor" }

# Guard
if ($txt.IndexOf("PHASE12B_BACKEND_PROBE") -ge 0) {
  Fail "Phase 12B backend probe already present. Aborting to avoid duplicates."
}

$insert = @'

      // PHASE12B_BACKEND_PROBE (read-only): does backend return vehicle_type / passenger_count?
      try {
        const b: any = (bj && ((bj as any).booking || bj)) as any;
        const vtRaw: any = b ? (b.vehicle_type || b.vehicleType) : "";
        const pcRaw: any = b ? (b.passenger_count ?? b.passengerCount) : "";

        const vt = String(vtRaw || "").trim();
        const pc =
          (pcRaw === null || pcRaw === undefined || pcRaw === "")
            ? ""
            : String(pcRaw).trim();

        if (vt || pc) {
          lines.push("vehicle_type: " + (vt || "(none)"));
          lines.push("passenger_count: " + (pc || "(none)"));
        } else {
          lines.push("vehicle_type/passenger_count: (not returned by API)");
        }
      } catch {
        lines.push("vehicle_type/passenger_count: (probe error)");
      }

'@

# Insert right before setResult(lines.join("\n"));
$txt = $txt.Replace($anchor, $insert + "      " + $anchor)

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $FileRel"
