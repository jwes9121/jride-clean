# PATCH-JRIDE_PHASE11H_ALWAYS_SHOW_VERIFY_CTA.ps1
# app/ride/page.tsx
# - Always show Verify account CTA when Verified is NO (even if night gate is OFF)
# - Remove the bad injected "(null as any)" line inside refreshCanBook
# - Auto-close verify panel when refreshCanBook receives verified status (no hooks)
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$target = "app\ride\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw
$orig = $txt

# 1) Remove any bad injected line referencing (null as any)?.verification_status
$txt = [regex]::Replace(
  $txt,
  "(?m)^\s*if\s*\(\s*String\(\(null\s+as\s+any\)\?\.[^\r\n]*\)\s*\{[^\r\n]*\}\s*\r?\n",
  ""
)

# 2) After setCanInfo(r.json as CanBookInfo); insert safe auto-close when verified
$anchorSet = "setCanInfo(r.json as CanBookInfo);"
if ($txt -notmatch [regex]::Escape($anchorSet)) { Fail "Could not find: $anchorSet" }

if ($txt -notmatch "AUTO_CLOSE_VERIFY_PANEL_ON_REFRESH") {
  $insert = @'
      // AUTO_CLOSE_VERIFY_PANEL_ON_REFRESH
      try {
        const st = String((r.json as any)?.verification_status || "").toLowerCase();
        if (st === "verified" || (r.json as any)?.verified === true) {
          setShowVerifyPanel(false);
        }
      } catch {
        // ignore
      }

'@
  $txt = $txt.Replace($anchorSet, $anchorSet + "`r`n" + $insert)
}

# 3) Add Verify account button in the pills row (next to Refresh status) when not verified
$pillsAnchor = @'
          <button
            type="button"
            onClick={refreshCanBook}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-1 text-xs font-semibold"
          >
            Refresh status
          </button>
'@

if ($txt -notmatch [regex]::Escape("Verify account") ) {
  if ($txt -notmatch [regex]::Escape($pillsAnchor)) { Fail "Could not locate Refresh status button block (pills row)." }

  $addBtn = @'
          {!verified ? (
            <button
              type="button"
              onClick={() => router.push("/verify")}
              className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-1 text-xs font-semibold"
            >
              Verify account
            </button>
          ) : null}

'@
  $txt = $txt.Replace($pillsAnchor, $pillsAnchor + $addBtn)
}

# 4) Bottom action CTA: show Go to verification whenever NOT verified (not only when blocked)
$txt = $txt.Replace("{unverifiedBlocked ? (", "{!verified ? (")

if ($txt -eq $orig) { Fail "No changes produced (already applied?)." }

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::UTF8)
Ok "Patched: always show Verify account CTA + fixed refreshCanBook auto-close."
