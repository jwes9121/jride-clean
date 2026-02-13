# PATCH-JRIDE_LIVETRIPS_UI_API_TRUTH.ps1
# One file only. UI-only. PowerShell 5. ASCII.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$root = Get-Location
$rel  = "app\admin\livetrips\LiveTripsClient.tsx"
$path = Join-Path $root $rel

if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $path

# --- 1) Harden postJson(): throw on ok:false ---
$oldPostJson = @'
  async function postJson(url: string, body: any) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j && (j.error || j.message)) || "REQUEST_FAILED");
    return j;
  }
'@

$newPostJson = @'
  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok || j?.ok === false) {
      const code = j?.code || "REQUEST_FAILED";
      const msg  = j?.message || j?.error || ("HTTP " + r.status);
      throw new Error(code + ": " + msg);
    }
    return j;
  }
'@

if ($txt -notmatch [regex]::Escape($oldPostJson.Trim())) {
  Fail "postJson block not found or already modified."
}

$txt = $txt.Replace($oldPostJson, $newPostJson)
Ok "postJson hardened (throws on ok:false)."

# --- 2) updateTripStatus(): success only on real success ---
$txt = $txt -replace `
'async function updateTripStatus\([\s\S]*?\n  \}',
@'
  async function updateTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    try {
      setLastAction("Updating status...");
      await postJson("/api/dispatch/status", { booking_code: bookingCode, bookingCode, status });
      setLastAction("Status updated");
      await loadPage();
    } catch (e: any) {
      setLastAction("Status update failed: " + String(e?.message || e));
    }
  }
'@
Ok "updateTripStatus now respects API truth."

# --- 3) forceTripStatus(): same behavior ---
$txt = $txt -replace `
'async function forceTripStatus\([\s\S]*?\n  \}',
@'
  async function forceTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    try {
      setLastAction("Forcing status...");
      await postJson("/api/dispatch/status", { booking_code: bookingCode, bookingCode, status, force: true });
      setLastAction("Force status sent");
      await loadPage();
    } catch (e: any) {
      setLastAction("Force failed: " + String(e?.message || e));
    }
  }
'@
Ok "forceTripStatus hardened."

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Info "Done."
