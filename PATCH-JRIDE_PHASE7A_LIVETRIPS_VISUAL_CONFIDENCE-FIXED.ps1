# PATCH-JRIDE_PHASE7A_LIVETRIPS_VISUAL_CONFIDENCE-FIXED.ps1
# PHASE 7A — LiveTrips Visual Confidence (FRONTEND ONLY)
# Fix: Avoid PS parser issues by using literal here-strings and simple safe insertions.
# Touches ONLY:
#   - app\admin\livetrips\LiveTripsClient.tsx
#   - app\admin\livetrips\components\LiveTripsMap.tsx

$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

function Backup($p){
  if(!(Test-Path -LiteralPath $p)){ Fail "Missing: $p" }
  $bak = "$p.bak.$(Stamp)"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  Write-Host "[OK] Backup $bak"
}

function ReadRaw($p){ Get-Content -LiteralPath $p -Raw }

function WriteUtf8NoBom($p,$c){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($p, $c, $enc)
  Write-Host "[OK] Wrote $p"
}

$CLIENT_PATH = "app\admin\livetrips\LiveTripsClient.tsx"
$MAP_PATH    = "app\admin\livetrips\components\LiveTripsMap.tsx"

Backup $CLIENT_PATH
Backup $MAP_PATH

# =========================
# 1) LiveTripsClient.tsx
# =========================
$txt = ReadRaw $CLIENT_PATH

# Insert helpers before computeIsProblem (once)
if ($txt -notmatch "function\s+statusBadgeClass\(") {
  $anchor = "function computeIsProblem"
  if ($txt -notmatch [regex]::Escape($anchor)) { Fail "Anchor not found in LiveTripsClient.tsx: $anchor" }

  $helpers = @'
function statusBadgeClass(s: string, isProblem: boolean, stale: boolean) {
  const base = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs";
  if (isProblem) return base + " border-red-300 bg-red-50 text-red-700";
  if (stale) return base + " border-amber-300 bg-amber-50 text-amber-800";

  switch (s) {
    case "requested":
    case "pending":
      return base + " border-slate-200 bg-slate-50 text-slate-700";
    case "assigned":
      return base + " border-indigo-200 bg-indigo-50 text-indigo-700";
    case "on_the_way":
      return base + " border-blue-200 bg-blue-50 text-blue-700";
    case "arrived":
      return base + " border-cyan-200 bg-cyan-50 text-cyan-700";
    case "enroute":
      return base + " border-sky-200 bg-sky-50 text-sky-700";
    case "on_trip":
      return base + " border-green-200 bg-green-50 text-green-700";
    case "completed":
      return base + " border-emerald-200 bg-emerald-50 text-emerald-700";
    case "cancelled":
      return base + " border-rose-200 bg-rose-50 text-rose-700";
    default:
      return base + " border-gray-200 bg-gray-50 text-gray-700";
  }
}

function freshnessText(mins: number) {
  if (!Number.isFinite(mins)) return "-";
  if (mins <= 0) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

'@

  $txt = $txt -replace "(?s)(function\s+computeIsProblem\s*\()", ($helpers + "`nfunction computeIsProblem(")
  Write-Host "[OK] Inserted statusBadgeClass + freshnessText."
}

# Add mins + stale after status normalization (once)
if ($txt -notmatch "const\s+mins\s*=\s*minutesSince") {
  $rowAnchor = "const s = normStatus"
  if ($txt -notmatch $rowAnchor) { Fail "Could not find row anchor containing: $rowAnchor" }

  $txt = [regex]::Replace(
    $txt,
    "const\s+s\s*=\s*normStatus\([^\)]*\);\s*",
    {
      param($m)
      return $m.Value + "const mins = minutesSince(t.updated_at || t.created_at || null);`n                    const stale = isActiveTripStatus(s) && mins >= 3;`n                    "
    },
    1
  )
  Write-Host "[OK] Added mins + stale in row block."
}

# Replace the simple status cell if present; otherwise insert next to status display
$old = @'
                        <td className="p-2">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                            {s || "—"}
                          </span>
                        </td>
'@

if ($txt -match [regex]::Escape($old)) {
  $new = @'
                        <td className="p-2">
                          <div className="flex flex-col">
                            <span className={statusBadgeClass(s, isProblem, stale)}>
                              {s || "—"}
                            </span>
                            <span className={stale ? "text-[10px] text-amber-800 mt-0.5" : "text-[10px] text-gray-500 mt-0.5"}>
                              {stale ? `STALE • ${freshnessText(mins)}` : freshnessText(mins)}
                            </span>
                          </div>
                        </td>
'@
  $txt = $txt -replace [regex]::Escape($old), $new
  Write-Host "[OK] Updated Status cell with badge + freshness."
} else {
  Write-Host "[WARN] Exact Status <td> block not found; skipping status cell replacement (no change)."
  Write-Host "       If UI didn’t change, paste the Status <td> block and I’ll patch the right target."
}

WriteUtf8NoBom $CLIENT_PATH $txt


# =========================
# 2) LiveTripsMap.tsx
# =========================
$map = ReadRaw $MAP_PATH

# Insert helpers once (near LngLatTuple or top types)
if ($map -notmatch "function\s+statusRingColor\(") {
  $anchor2 = "type LngLatTuple"
  if ($map -notmatch $anchor2) { Fail "Could not find anchor containing: $anchor2 in LiveTripsMap.tsx" }

  $helpers2 = @'
function statusRingColor(s: string): string {
  const x = String(s || "").trim().toLowerCase();
  switch (x) {
    case "requested":
    case "pending": return "#94a3b8";   // slate
    case "assigned": return "#6366f1";  // indigo
    case "on_the_way": return "#3b82f6";// blue
    case "arrived": return "#06b6d4";   // cyan
    case "enroute": return "#0ea5e9";   // sky
    case "on_trip": return "#22c55e";   // green
    case "completed": return "#10b981"; // emerald
    case "cancelled": return "#f43f5e"; // rose
    default: return "#9ca3af";          // gray
  }
}

function minutesSinceIso(iso: any): number {
  if (!iso) return 999999;
  const t = new Date(String(iso)).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.floor((Date.now() - t) / 60000);
}

'@

  $map = [regex]::Replace($map, "(type\s+LngLatTuple[^\n]*\n)", ('$1' + "`n" + $helpers2 + "`n"), 1)
  Write-Host "[OK] Inserted map helpers (statusRingColor + minutesSinceIso)."
}

# Add marker styling right after the trike icon src line
$needle = 'el.src = "/icons/jride-trike.png";'
if ($map -notmatch [regex]::Escape($needle)) { Fail "Could not find marker needle in LiveTripsMap.tsx: $needle" }

if ($map -notmatch "JRIDE_PHASE7A_MARKER_RING") {
  $styleLines = @'
          // JRIDE_PHASE7A_MARKER_RING
          const statusNorm = String((raw as any).status ?? "").trim().toLowerCase();
          const ring = statusRingColor(statusNorm);
          const lastSeenIso = (raw as any).driver_last_seen_at ?? (raw as any).updated_at ?? (raw as any).inserted_at ?? null;
          const ageMin = minutesSinceIso(lastSeenIso);
          const stale = (["assigned","on_the_way","on_trip"].includes(statusNorm) && ageMin >= 3);

          // Visual confidence ring + stale glow (UI-only)
          el.style.boxSizing = "content-box";
          el.style.border = "3px solid " + ring;
          el.style.borderRadius = "9999px";
          el.style.padding = "3px";
          if (stale) el.style.boxShadow = "0 0 0 6px rgba(245,158,11,0.35)";
'@

  $map = $map -replace [regex]::Escape($needle), ($needle + "`n" + $styleLines)
  Write-Host "[OK] Added marker ring + stale glow styling after trike src line."
} else {
  Write-Host "[OK] Marker ring already present; skipping."
}

WriteUtf8NoBom $MAP_PATH $map

Write-Host ""
Write-Host "[DONE] PHASE 7A applied (FIXED): status colors + freshness + marker ring/glow."
