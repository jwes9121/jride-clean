# PATCH-JRIDE_RIDE_ADD_LOCAL_LANDMARK_MATCHES_V1.ps1
# Fix: Type error "Cannot find name 'localLandmarkMatches'" in app\ride\page.tsx

$ErrorActionPreference = "Stop"

$ROOT = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$FILE = Join-Path $ROOT "app\ride\page.tsx"
if (!(Test-Path $FILE)) { throw "Missing file: $FILE" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FILE.bak.$ts"
Copy-Item $FILE $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $FILE -Raw

# If already present, do nothing
if ($txt -match "(?m)^\s*function\s+localLandmarkMatches\s*\(") {
  Write-Host "[SKIP] localLandmarkMatches() already exists."
  exit 0
}

# Anchor: place it after getTownGeo() if possible; otherwise after Mapbox section header
$anchor1 = "function getTownGeo"
$anchor2 = "// ===== Mapbox geocode + map tap picker (UI-only) ====="

$pos = $txt.IndexOf($anchor1, [System.StringComparison]::Ordinal)
if ($pos -ge 0) {
  # Insert after the end of getTownGeo() block by finding the next blank line after it (safe heuristic)
  $afterPos = $txt.IndexOf("`n`n", $pos)
  if ($afterPos -lt 0) { $afterPos = $pos }
  $insAt = $afterPos + 2
} else {
  $p2 = $txt.IndexOf($anchor2, [System.StringComparison]::Ordinal)
  if ($p2 -lt 0) { throw "Anchor missing: $anchor2" }
  $lineEnd = $txt.IndexOf("`n", $p2)
  if ($lineEnd -lt 0) { $lineEnd = $txt.Length - 1 }
  $insAt = $lineEnd + 1
}

$helper = @'
  // Local landmarks per town (simple + driver/passenger friendly).
  // Returns GeoFeature[]-like objects compatible with current UI (place_name, text, center).
  function localLandmarkMatches(q: string, townName: string): any[] {
    const query = String(q || "").trim().toLowerCase();
    if (!query) return [];

    const tk = String(townName || "").trim().toLowerCase();

    const DB: Record<string, Array<{ name: string; center: [number, number] }>> = {
      hingyon: [
        { name: "Hingyon Municipal Hall", center: [121.102294, 16.865595] },
        { name: "Hingyon Town Proper", center: [121.102294, 16.865595] },
        { name: "Hingyon District Hospital", center: [121.102294, 16.865595] },
        { name: "Barangay Hall (Hingyon)", center: [121.102294, 16.865595] },
      ],
      lagawe: [
        { name: "Lagawe Municipal Hall", center: [121.124289, 16.801351] },
        { name: "Lagawe Town Proper", center: [121.124289, 16.801351] },
        { name: "Ifugao Provincial Capitol", center: [121.124289, 16.801351] },
        { name: "Lagawe District Hospital", center: [121.124289, 16.801351] },
      ],
      banaue: [
        { name: "Banaue Municipal Hall", center: [121.061840, 16.913560] },
        { name: "Banaue Town Proper", center: [121.061840, 16.913560] },
        { name: "Banaue Public Market", center: [121.061840, 16.913560] },
        { name: "Banaue District Hospital", center: [121.061840, 16.913560] },
      ],
    };

    const list = DB[tk] || [];
    if (!list.length) return [];

    // Basic fuzzy match: include if all query tokens exist in name
    const toks = query.split(/\s+/).filter(Boolean);
    const hits = list.filter((it) => {
      const n = it.name.toLowerCase();
      for (const t of toks) if (!n.includes(t)) return false;
      return true;
    });

    return hits.map((it) => ({
      id: "local:" + tk + ":" + it.name,
      text: it.name,
      place_name: it.name + ", " + townName + ", Ifugao",
      center: [it.center[0], it.center[1]],
      geometry: { type: "Point", coordinates: [it.center[0], it.center[1]] },
      place_type: ["poi"],
      properties: { source: "local" },
    }));
  }

'@

$before = $txt.Substring(0, $insAt)
$after  = $txt.Substring($insAt)

$txt2 = $before + $helper + $after
if ($txt2 -eq $txt) { throw "Injection failed - file unchanged." }

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($FILE, $txt2, $utf8NoBom)

Write-Host "[OK] Patched: $FILE"
Write-Host ""
Write-Host "[NEXT] Build:"
Write-Host "  Set-Location `"$ROOT`""
Write-Host "  npm.cmd run build"
