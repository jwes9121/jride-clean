# PATCH-JRIDE_RIDE_SEARCHBOX_TRIGGER_ON_NO_POI.ps1
# One file only: app\ride\page.tsx
# PowerShell 5. ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$path = Join-Path (Get-Location) "app\ride\page.tsx"
if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $path

# We replace the geocodeForward() tail where hasGood/hasPOI + fallback logic lives.
$pat = '(?s)const\s+hasGood\s*=\s*.*?return\s+sorted\.map\(\(f\)\s*=>\s*\(\{\s*kind:\s*"geocode",\s*f:\s*f\s*\}\s*as\s*any\)\);\s*'
if ($txt -notmatch $pat) {
  Fail "Anchor not found: hasGood block in geocodeForward(). Paste lines around geocodeForward() for patching."
}

$replacement = @'
const hasPOI =
      sorted.some((f) => (f.place_type || []).indexOf("poi") >= 0);

    const geoItems = sorted.map((f) => ({ kind: "geocode", f: f } as any));

    // IMPORTANT: If NO POI is present, call Searchbox (POI-focused) even if address/place exists.
    if (!hasPOI) {
      try {
        const sbq = norm(raw) ? (norm(raw) + ", " + town + ", Ifugao") : q;
        const sb = await searchboxSuggest(sbq);

        // Show POI suggestions first, then fallback geocode results.
        if (sb && sb.length) return ([] as any[]).concat(sb as any, geoItems as any);
      } catch (e: any) {
        setGeoErr(String(e?.message || e));
        // still show geocode results if any
      }
    }

    return geoItems;
'@

$txt2 = [regex]::Replace($txt, $pat, $replacement, 1)

Set-Content -Path $path -Value $txt2 -Encoding UTF8
Ok "Patched: app\ride\page.tsx (Searchbox triggers when no POI)"
