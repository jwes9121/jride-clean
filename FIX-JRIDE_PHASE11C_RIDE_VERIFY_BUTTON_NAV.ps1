# FIX-JRIDE_PHASE11C_RIDE_VERIFY_BUTTON_NAV.ps1
# UI-only patch for app/ride/page.tsx
# - Fix "Go to verification" buttons to navigate to /verify
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$target = Join-Path (Get-Location) "app\ride\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$txt = Get-Content $target -Raw
$orig = $txt

# Replace old handler with navigation.
# This handler was used by the top banner button and the bottom action button.
$needle = 'onClick={() => setShowVerifyPanel(true)}'
$repl   = 'onClick={() => router.push("/verify")}'

if ($txt -notmatch [regex]::Escape($needle)) {
  Fail "Anchor not found: $needle"
}

$txt = $txt.Replace($needle, $repl)

# Defensive ASCII cleanup
$txt = $txt.Replace([char]0x2019, "'").Replace([char]0x2018, "'")
$txt = $txt.Replace([char]0x2014, "-").Replace([char]0x2013, "-")

if ($txt -eq $orig) { Fail "No changes produced (unexpected)." }

[System.IO.File]::WriteAllText($target, $txt, [System.Text.Encoding]::ASCII)
Ok "Patched: $target"
Info "Done. Run npm build next."
