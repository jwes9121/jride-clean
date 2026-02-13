# FIX-JRIDE_WALLET_ADJUST_LOOKUP_SCOPE_V2.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path
$path = Join-Path $root "app\admin\wallet-adjust\page.tsx"
if (-not (Test-Path $path)) { Fail "Missing: $path" }

Copy-Item -Force $path "$path.bak.$(Stamp)"
Ok "Backup created: $path.bak.$(Stamp)"

$txt = Get-Content -Path $path -Raw

# ---------- 1) REMOVE any existing lookup block (wherever it lives) ----------
$removedAny = $false

# A) Prefer removal by our markers if present
$markerPattern = '(?s)\n?\s*//\s*=====\s*JRIDE_ADMIN_WALLET_LOOKUP_STATE_START\s*=====\s*.*?//\s*=====\s*JRIDE_ADMIN_WALLET_LOOKUP_STATE_END\s*=====\s*\n?'
if ([regex]::IsMatch($txt, $markerPattern)) {
  $txt = [regex]::Replace($txt, $markerPattern, "`n")
  Ok "Removed existing lookup block by marker."
  $removedAny = $true
}

# B) Remove by "Lookup state" comment (older variants)
$commentPattern = '(?s)\n?\s*//\s*Lookup state\s*.*?async function\s+runVendorLookup\s*\(.*?\)\s*\{.*?\n\s*\}\s*\n'
if ([regex]::IsMatch($txt, $commentPattern)) {
  $txt = [regex]::Replace($txt, $commentPattern, "`n")
  Ok "Removed existing lookup block by 'Lookup state' comment pattern."
  $removedAny = $true
}

# C) Remove by matching the actual state tuple name, regardless of whitespace
# Covers: const [lookup,setLookup] = useState(...); + lookupBusy + both functions
$tuplePattern = '(?s)\n?\s*const\s*\[\s*lookup\s*,\s*setLookup\s*\]\s*=\s*useState.*?;\s*' +
                '\s*const\s*\[\s*lookupBusy\s*,\s*setLookupBusy\s*\]\s*=\s*useState.*?;\s*' +
                '.*?async function\s+runDriverLookup\s*\(.*?\)\s*\{.*?\n\s*\}\s*' +
                '.*?async function\s+runVendorLookup\s*\(.*?\)\s*\{.*?\n\s*\}\s*\n'
if ([regex]::IsMatch($txt, $tuplePattern)) {
  $txt = [regex]::Replace($txt, $tuplePattern, "`n")
  Ok "Removed existing lookup block by tuple+functions regex."
  $removedAny = $true
}

if (-not $removedAny) {
  Info "No removable lookup state block found by regex (it may already be missing or in an unexpected shape)."
  Info "We'll still inject the correct block inside the component."
}

# ---------- 2) INJECT lookup block INSIDE the component function ----------
$fnPos = $txt.IndexOf("export default function")
if ($fnPos -lt 0) { Fail "Could not find: export default function" }

$bracePos = $txt.IndexOf("{", $fnPos)
if ($bracePos -lt 0) { Fail "Could not find component opening { after export default function" }

# Safety: refuse if we already injected inside component (marker)
if ($txt -like "*JRIDE_ADMIN_WALLET_LOOKUP_STATE_START*") {
  Fail "Marker already present after cleanup; refusing to duplicate insertion."
}

$inject = @'

  // ===== JRIDE_ADMIN_WALLET_LOOKUP_STATE_START =====
  const [lookup, setLookup] = useState<any>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  async function runDriverLookup(driver_id: string) {
    setLookupBusy(true); setLookup(null);
    try {
      const headers: Record<string, string> = {};
      // Optional admin key support if your page has an adminKey state
      // @ts-ignore
      if (typeof adminKey !== "undefined" && String(adminKey || "").trim()) {
        headers["x-admin-key"] = String(adminKey || "").trim();
      }

      const res = await fetch(
        `/api/admin/wallet/driver-summary?driver_id=${encodeURIComponent(driver_id)}`,
        { headers }
      );
      const data = await res.json();
      setLookup(data);
    } catch (e: any) {
      setLookup({ ok: false, error: e?.message || String(e) });
    } finally {
      setLookupBusy(false);
    }
  }

  async function runVendorLookup(vendor_id: string) {
    setLookupBusy(true); setLookup(null);
    try {
      const headers: Record<string, string> = {};
      // @ts-ignore
      if (typeof adminKey !== "undefined" && String(adminKey || "").trim()) {
        headers["x-admin-key"] = String(adminKey || "").trim();
      }

      const res = await fetch(
        `/api/admin/wallet/vendor-summary?vendor_id=${encodeURIComponent(vendor_id)}`,
        { headers }
      );
      const data = await res.json();
      setLookup(data);
    } catch (e: any) {
      setLookup({ ok: false, error: e?.message || String(e) });
    } finally {
      setLookupBusy(false);
    }
  }
  // ===== JRIDE_ADMIN_WALLET_LOOKUP_STATE_END =====

'@

$insertAt = $bracePos + 1
$txt = $txt.Substring(0, $insertAt) + $inject + $txt.Substring($insertAt)
Ok "Injected lookup state/functions inside component scope."

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $path"
Ok "DONE. Rebuild now."
