# PATCH-JRIDE_PHASE11C_OPTIOND_KEYBOARD_NAV_SUGGESTIONS_FIXED.ps1
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

# ---- Anchors ----
if ($txt.IndexOf('const toDebounceRef = React.useRef<any>(null);') -lt 0) { Fail "Anchor not found: toDebounceRef" }
if ($txt.IndexOf('function renderGeoList(field: "from" | "to") {') -lt 0) { Fail "Anchor not found: renderGeoList header" }
if ($txt.IndexOf('// Debounced geocoding for pickup label') -lt 0) { Fail "Anchor not found: Debounced geocoding comment" }

if ($txt.IndexOf('value={fromLabel}') -lt 0) { Fail "Anchor not found: fromLabel input value" }
if ($txt.IndexOf('value={toLabel}') -lt 0) { Fail "Anchor not found: toLabel input value" }

# ---- 1) Insert keyboard nav state after debounce refs ----
$anchor1 = 'const toDebounceRef = React.useRef<any>(null);'
if ($txt.IndexOf("geoNavFromIdx") -lt 0) {
  $ins1 = @"
const toDebounceRef = React.useRef<any>(null);

  // Keyboard navigation for suggestions (UI-only)
  const [geoNavFromIdx, setGeoNavFromIdx] = React.useState<number>(-1);
  const [geoNavToIdx, setGeoNavToIdx] = React.useState<number>(-1);

"@
  $txt = $txt.Replace($anchor1, $ins1)
  Write-Host "[OK] Inserted geoNavFromIdx/geoNavToIdx state."
} else {
  Write-Host "[OK] Keyboard nav state already present; skipping."
}

# ---- 2) Replace renderGeoList() with keyboard-aware version ----
$reList = '(?s)function\s+renderGeoList\(field:\s*"from"\s*\|\s*"to"\)\s*\{\s*.*?\n\s*\}\s*\n\s*// Debounced geocoding for pickup label'
if (-not [regex]::IsMatch($txt, $reList)) { Fail "Could not locate renderGeoList block for replacement." }

$newList = @"
function renderGeoList(field: "from" | "to") {
    const items = field === "from" ? geoFrom : geoTo;
    const open = activeGeoField === field && items && items.length > 0;

    if (!open) return null;

    const activeIdx = field === "from" ? geoNavFromIdx : geoNavToIdx;
    const selectedId = field === "from" ? selectedGeoFromId : selectedGeoToId;

    return (
      <div className="mt-2 rounded-xl border border-black/10 bg-white shadow-sm overflow-hidden">
        {items.map((f, idx) => {
          const label = String(f.place_name || f.text || "").trim() || "(unknown)";
          const id = String((f.mapbox_id || f.id || "")).trim();

          const isActive = idx === activeIdx;
          const isSelected = !!selectedId && !!id && selectedId === id;

          const cls =
            "w-full text-left px-3 py-2 text-sm " +
            (isActive ? "bg-black/10 " : "hover:bg-black/5 ") +
            (isSelected ? "font-semibold " : "");

          return (
            <button
              key={(f.id || "") + "_" + String(idx)}
              type="button"
              className={cls}
              onMouseEnter={() => {
                if (field === "from") setGeoNavFromIdx(idx);
                else setGeoNavToIdx(idx);
              }}
              onClick={() => {
                if (id) {
                  if (field === "from") setSelectedGeoFromId(id);
                  else setSelectedGeoToId(id);
                }
                applyGeoSelection(field, f);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  // Debounced geocoding for pickup label
"@

$txt = [regex]::Replace($txt, $reList, $newList, 1)
Write-Host "[OK] Updated renderGeoList() for keyboard navigation."

# ---- 3) Patch pickup label input block ----
$reFromInput = '(?s)(<input\s*\n\s*className="w-full rounded-xl border border-black/10 px-3 py-2"\s*\n\s*value=\{fromLabel\}\s*\n\s*onFocus=\{\(\)\s*=>\s*\{\s*setActiveGeoField\("from"\);\s*\}\}\s*\n\s*onChange=\{\(e\)\s*=>\s*\{\s*setFromLabel\(e\.target\.value\);\s*setActiveGeoField\("from"\);\s*\}\}\s*\n\s*/>)'
if (-not [regex]::IsMatch($txt, $reFromInput)) { Fail "Could not locate pickup label input block for patch." }

$fromNew = @"
<input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={fromLabel}
              onFocus={() => { setActiveGeoField("from"); }}
              onChange={(e) => { setFromLabel(e.target.value); setActiveGeoField("from"); setGeoNavFromIdx(-1); }}
              onKeyDown={(e) => {
                const items = geoFrom || [];
                const open = activeGeoField === "from" && items.length > 0;

                if (e.key === "Escape") {
                  e.preventDefault();
                  setActiveGeoField(null);
                  setGeoFrom([]);
                  setGeoNavFromIdx(-1);
                  return;
                }

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (!open) { setActiveGeoField("from"); return; }
                  const next = Math.min((geoNavFromIdx < 0 ? 0 : geoNavFromIdx + 1), items.length - 1);
                  setGeoNavFromIdx(next);
                  return;
                }

                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!open) { setActiveGeoField("from"); return; }
                  const prev = Math.max((geoNavFromIdx < 0 ? items.length - 1 : geoNavFromIdx - 1), 0);
                  setGeoNavFromIdx(prev);
                  return;
                }

                if (e.key === "Enter") {
                  if (!open) return;
                  e.preventDefault();
                  const idx = geoNavFromIdx < 0 ? 0 : geoNavFromIdx;
                  const f = items[idx];
                  if (f) {
                    const id = String((f.mapbox_id || f.id || "")).trim();
                    if (id) setSelectedGeoFromId(id);
                    applyGeoSelection("from", f);
                  }
                }
              }}
            />
"@

$txt = [regex]::Replace($txt, $reFromInput, $fromNew, 1)
Write-Host "[OK] Patched pickup input with keyboard handlers."

# ---- 4) Patch dropoff label input block ----
$reToInput = '(?s)(<input\s*\n\s*className="w-full rounded-xl border border-black/10 px-3 py-2"\s*\n\s*value=\{toLabel\}\s*\n\s*onFocus=\{\(\)\s*=>\s*\{\s*setActiveGeoField\("to"\);\s*\}\}\s*\n\s*onChange=\{\(e\)\s*=>\s*\{\s*setToLabel\(e\.target\.value\);\s*setActiveGeoField\("to"\);\s*\}\}\s*\n\s*/>)'
if (-not [regex]::IsMatch($txt, $reToInput)) { Fail "Could not locate dropoff label input block for patch." }

$toNew = @"
<input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={toLabel}
              onFocus={() => { setActiveGeoField("to"); }}
              onChange={(e) => { setToLabel(e.target.value); setActiveGeoField("to"); setGeoNavToIdx(-1); }}
              onKeyDown={(e) => {
                const items = geoTo || [];
                const open = activeGeoField === "to" && items.length > 0;

                if (e.key === "Escape") {
                  e.preventDefault();
                  setActiveGeoField(null);
                  setGeoTo([]);
                  setGeoNavToIdx(-1);
                  return;
                }

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (!open) { setActiveGeoField("to"); return; }
                  const next = Math.min((geoNavToIdx < 0 ? 0 : geoNavToIdx + 1), items.length - 1);
                  setGeoNavToIdx(next);
                  return;
                }

                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!open) { setActiveGeoField("to"); return; }
                  const prev = Math.max((geoNavToIdx < 0 ? items.length - 1 : geoNavToIdx - 1), 0);
                  setGeoNavToIdx(prev);
                  return;
                }

                if (e.key === "Enter") {
                  if (!open) return;
                  e.preventDefault();
                  const idx = geoNavToIdx < 0 ? 0 : geoNavToIdx;
                  const f = items[idx];
                  if (f) {
                    const id = String((f.mapbox_id || f.id || "")).trim();
                    if (id) setSelectedGeoToId(id);
                    applyGeoSelection("to", f);
                  }
                }
              }}
            />
"@

$txt = [regex]::Replace($txt, $reToInput, $toNew, 1)
Write-Host "[OK] Patched dropoff input with keyboard handlers."

Set-Content -LiteralPath $FilePath -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $FileRel"
