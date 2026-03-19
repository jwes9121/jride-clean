<#
  JRIDE ScriptD — Hide passenger-irrelevant debug/helper blocks
  Target: app/ride/page.tsx

  Changes (all UI-only, narrow class/attribute additions):
    1) Duplicate boxed "What's happening now?" IIFE (P1B REAL) -> add hidden
    2) Preflight panel (Sign in required / READY / NOT READY) -> add hidden
    3) Raw debug grid (Status / Driver below receipt) -> add hidden
    4) Raw "Last update" line below debug grid -> add hidden
    5) Yellow BOOKING_POLL_FAILED warning box -> add hidden

  Method: Single-line anchor match, add "hidden " to className.
  NO BOM. NO reordering. NO block wrapping. NO backend changes.
#>

$ErrorActionPreference = "Stop"

$target = "app/ride/page.tsx"

if (!(Test-Path $target)) {
    Write-Host "ERROR: $target not found. Run from project root." -ForegroundColor Red
    exit 1
}

$lines = [System.IO.File]::ReadAllLines((Resolve-Path $target).Path, [System.Text.Encoding]::UTF8)
$changeCount = 0

# ============================================================
# 1) Hide duplicate boxed "What's happening now?" (P1B REAL IIFE)
#    Anchor: <div className="mt-2 rounded-xl border border-black/10 bg-white p-2 text-xs">
#    that is INSIDE the IIFE right after the comment "PHASE P1B: What's happening now?"
#    and contains "What's happening now?" on the next line.
#    We add "hidden " to its className.
# ============================================================

for ($i = 0; $i -lt $lines.Length; $i++) {
    $trimmed = $lines[$i].Trim()
    if ($trimmed -eq '<div className="mt-2 rounded-xl border border-black/10 bg-white p-2 text-xs">') {
        # Check next line for "What's happening now?"
        if (($i + 1) -lt $lines.Length -and $lines[$i + 1].Trim() -eq '<div className="font-semibold">What''s happening now?</div>') {
            # Also verify this is in the REAL section (not the DEBUG one which is already hidden)
            $alreadyHidden = $trimmed.Contains("hidden")
            if (-not $alreadyHidden) {
                $indent = $lines[$i] -replace '(\s*).*', '$1'
                $lines[$i] = $indent + '<div className="hidden mt-2 rounded-xl border border-black/10 bg-white p-2 text-xs">'
                $changeCount++
                Write-Host "[1] Duplicate 'What''s happening now?' box hidden at line $($i+1)." -ForegroundColor Green
            }
        }
    }
}

# ============================================================
# 2) Hide Preflight panel (P4: "Sign in required" / READY / NOT READY)
#    Anchor: the IIFE that calls p4Preflight and renders a card with pf.title
#    We hide the outer div by matching:
#    <div className={"mt-3 rounded-2xl border p-3 " + (pf.ok ?
# ============================================================

for ($i = 0; $i -lt $lines.Length; $i++) {
    $trimmed = $lines[$i].Trim()
    if ($trimmed.Contains('className={"mt-3 rounded-2xl border p-3 "') -and $trimmed.Contains('pf.ok')) {
        $alreadyHidden = $trimmed.Contains("hidden")
        if (-not $alreadyHidden) {
            $indent = $lines[$i] -replace '(\s*).*', '$1'
            $lines[$i] = $indent + '<div className={"hidden mt-3 rounded-2xl border p-3 " + (pf.ok ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50")}>'
            $changeCount++
            Write-Host "[2] Preflight panel (Sign in / READY) hidden at line $($i+1)." -ForegroundColor Green
        }
    }
}

# ============================================================
# 3) Hide raw debug grid (Status / Driver below trip receipt)
#    Anchor: <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
#    that contains Status and Driver cells right after END PHASE P2
#    We look for this div where the next few lines contain "Status" and "Driver" labels
# ============================================================

for ($i = 0; $i -lt $lines.Length; $i++) {
    $trimmed = $lines[$i].Trim()
    if ($trimmed -eq '<div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">') {
        # Check nearby lines for Status + Driver labels (the raw debug grid, not the receipt)
        $hasStatus = $false
        $hasDriver = $false
        $nearReceipt = $false
        for ($j = $i + 1; $j -lt [Math]::Min($i + 12, $lines.Length); $j++) {
            $lt = $lines[$j].Trim()
            if ($lt -eq '<div className="text-xs opacity-70">Status</div>') { $hasStatus = $true }
            if ($lt -eq '<div className="text-xs opacity-70">Driver</div>') { $hasDriver = $true }
        }
        # Check if this is preceded by END PHASE P2
        for ($j = [Math]::Max(0, $i - 5); $j -lt $i; $j++) {
            if ($lines[$j].Contains("END PHASE P2")) { $nearReceipt = $true; break }
        }
        if ($hasStatus -and $hasDriver -and $nearReceipt) {
            $indent = $lines[$i] -replace '(\s*).*', '$1'
            $lines[$i] = $indent + '<div className="hidden mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">'
            $changeCount++
            Write-Host "[3] Raw debug grid (Status/Driver) hidden at line $($i+1)." -ForegroundColor Green
        }
    }
}

# ============================================================
# 4) Hide raw "Last update" line
#    Anchor: <div className="mt-2 text-xs opacity-70">
#    followed by Last update: {liveUpdatedAt ...
# ============================================================

for ($i = 0; $i -lt $lines.Length; $i++) {
    $trimmed = $lines[$i].Trim()
    if ($trimmed -eq '<div className="mt-2 text-xs opacity-70">') {
        if (($i + 1) -lt $lines.Length -and $lines[$i + 1].Trim().StartsWith('Last update:')) {
            $alreadyHidden = $trimmed.Contains("hidden")
            if (-not $alreadyHidden) {
                $indent = $lines[$i] -replace '(\s*).*', '$1'
                $lines[$i] = $indent + '<div className="hidden mt-2 text-xs opacity-70">'
                $changeCount++
                Write-Host "[4] Raw 'Last update' line hidden at line $($i+1)." -ForegroundColor Green
            }
        }
    }
}

# ============================================================
# 5) Hide yellow BOOKING_POLL_FAILED warning box
#    Anchor: <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
#    inside the {liveErr ? ( ... ) : null} block
#    We hide it by adding hidden to the outer wrapper.
#    The conditional {liveErr ? (...) : null} is on a separate line,
#    so we target the rendered div inside it.
# ============================================================

for ($i = 0; $i -lt $lines.Length; $i++) {
    $trimmed = $lines[$i].Trim()
    if ($trimmed -eq '<div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2">') {
        # Verify it's in the liveErr block
        $isLiveErr = $false
        for ($j = [Math]::Max(0, $i - 4); $j -lt $i; $j++) {
            if ($lines[$j].Contains("liveErr")) { $isLiveErr = $true; break }
        }
        if ($isLiveErr) {
            $indent = $lines[$i] -replace '(\s*).*', '$1'
            $lines[$i] = $indent + '<div className="hidden mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2">'
            $changeCount++
            Write-Host "[5] Yellow BOOKING_POLL_FAILED warning hidden at line $($i+1)." -ForegroundColor Green
        }
    }
}

# ============================================================
# WRITE — UTF-8 NO BOM
# ============================================================

if ($changeCount -eq 0) {
    Write-Host "`nWARN: No changes applied. Anchors may not match current file." -ForegroundColor Yellow
    exit 1
}

$enc = New-Object System.Text.UTF8Encoding($false)
$text = ($lines -join "`r`n") + "`r`n"
[System.IO.File]::WriteAllText((Resolve-Path $target).Path, $text, $enc)

Write-Host "`nPatch applied ($changeCount changes). UTF-8 no BOM." -ForegroundColor Green
Write-Host "Hidden blocks:" -ForegroundColor Cyan
Write-Host "  1) Duplicate boxed 'What''s happening now?'" -ForegroundColor Cyan
Write-Host "  2) Preflight panel (Sign in required / READY)" -ForegroundColor Cyan
Write-Host "  3) Raw Status / Driver debug grid" -ForegroundColor Cyan
Write-Host "  4) Raw 'Last update' timestamp line" -ForegroundColor Cyan
Write-Host "  5) Yellow BOOKING_POLL_FAILED warning box" -ForegroundColor Cyan
Write-Host "Kept intact: main Trip status card, timeline, fare breakdown, driver details." -ForegroundColor Cyan
