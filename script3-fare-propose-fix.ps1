# ============================================================
# SCRIPT 3 — FARE PROPOSE BACKEND FIX
# ============================================================
# Root cause analysis:
#   POST /api/driver/fare/propose writes status='fare_proposed'
#   If bookings_status_check constraint does NOT include 'fare_proposed',
#   the DB update will fail with a constraint violation -> HTTP 500.
#
# Fix strategy:
#   Option A: If fare_proposed IS in the constraint, the 500 is elsewhere
#   Option B: If fare_proposed is NOT in the constraint, we must either:
#     B1. Add it to the constraint (preferred, requires DB access)
#     B2. Skip the status change and only write proposed_fare (safe fallback)
#
# This script implements B2 as a safe surgical fallback that works
# regardless of DB constraint, while preserving the fare data write.
#
# RUN:
#   powershell -ExecutionPolicy Bypass -File .\public\jride-patches\script3-fare-propose-fix.ps1
#
# THEN:
#   npm run build
# ============================================================

$ErrorActionPreference = "Stop"
$repoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"

# --- Locate fare propose route ---
$candidates = @(
    "app\api\driver\fare\propose\route.ts",
    "app\api\driver\fare-propose\route.ts",
    "app\api\dispatch\fare-propose\route.ts"
)

$target = $null
foreach ($c in $candidates) {
    $full = Join-Path $repoRoot $c
    if (Test-Path $full) {
        $target = $full
        break
    }
}

if (-not $target) {
    Write-Host "FATAL: fare propose route.ts not found." -ForegroundColor Red
    Write-Host "Searched:" -ForegroundColor Red
    foreach ($c in $candidates) {
        Write-Host "  $(Join-Path $repoRoot $c)" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "If the route exists at a different path, update the candidates array." -ForegroundColor Yellow
    exit 1
}

Write-Host "Found: $target" -ForegroundColor Green

# --- Timestamped backup ---
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $repoRoot "_backups\fare-propose"
if (-not (Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir -Force | Out-Null }
$bakFile = Join-Path $bakDir "route.ts.$ts.bak"
Copy-Item -Path $target -Destination $bakFile -Force
Write-Host "BACKUP: $target -> $bakFile" -ForegroundColor Green

# --- Read file ---
$content = [System.IO.File]::ReadAllText($target, [System.Text.UTF8Encoding]::new($false))

# --- Content fingerprint validation ---
if ($content -notmatch 'proposed_fare') {
    Write-Host "FATAL: File does not contain 'proposed_fare'. Wrong file?" -ForegroundColor Red
    exit 1
}
if ($content -notmatch 'bookings') {
    Write-Host "FATAL: File does not reference 'bookings' table. Wrong file?" -ForegroundColor Red
    exit 1
}

Write-Host "Content fingerprint OK (proposed_fare + bookings found)" -ForegroundColor Green

# --- DIAGNOSE: Check if route writes status: "fare_proposed" ---
$writesFareProposed = $content -match 'status:\s*[''"]fare_proposed[''"]'

if ($writesFareProposed) {
    Write-Host ""
    Write-Host "CONFIRMED: Route writes status='fare_proposed' to bookings table." -ForegroundColor Yellow
    Write-Host "This is the likely cause of HTTP 500 if bookings_status_check" -ForegroundColor Yellow
    Write-Host "does not include 'fare_proposed' in its allowed values." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "APPLYING FIX: Make status write conditional with try-catch fallback." -ForegroundColor Cyan
} else {
    Write-Host "Route does NOT write status='fare_proposed'. The 500 may have a different cause." -ForegroundColor Yellow
    Write-Host "Inspecting for other potential issues..." -ForegroundColor Yellow
}

# --- SURGICAL PATCH ---
# Strategy: Replace the single .update() call that sets both proposed_fare AND status
# with a two-step approach:
#   Step 1: Write proposed_fare + driver_id + updated_at (always succeeds)
#   Step 2: Try to set status='fare_proposed' separately, catch and warn if constraint blocks it
#
# This ensures the fare data is ALWAYS saved even if status transition is blocked.

$lines = $content -split "`n"
$newLines = [System.Collections.ArrayList]::new()
$patched = $false

for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]

    # Find the .update() block that sets status: "fare_proposed"
    # Pattern: .update({ ... status: "fare_proposed" ... })
    if ($line -match '\.update\(\s*\{' -and -not $patched) {
        # Look ahead to see if this update block contains fare_proposed
        $blockLines = @($line)
        $j = $i + 1
        $braceDepth = ([regex]::Matches($line, '\{')).Count - ([regex]::Matches($line, '\}')).Count
        
        while ($j -lt $lines.Count -and $braceDepth -gt 0) {
            $blockLines += $lines[$j]
            $braceDepth += ([regex]::Matches($lines[$j], '\{')).Count
            $braceDepth -= ([regex]::Matches($lines[$j], '\}')).Count
            $j++
        }

        $blockText = $blockLines -join "`n"

        if ($blockText -match 'fare_proposed') {
            Write-Host "  Found fare_proposed update block at lines $($i + 1)-$j" -ForegroundColor Green

            # Rewrite: split into safe write + guarded status write
            $indent = "    "

            [void]$newLines.Add("${indent}// Step 1: Always write fare data (safe, no constraint risk)")
            [void]$newLines.Add("${indent}const safePayload: Record<string, any> = {")
            [void]$newLines.Add("${indent}  driver_id,")
            [void]$newLines.Add("${indent}  proposed_fare: proposed,")
            [void]$newLines.Add("${indent}  updated_at: new Date().toISOString(),")
            [void]$newLines.Add("${indent}};")
            [void]$newLines.Add("")
            [void]$newLines.Add("${indent}const { error: upErr } = await supabase")
            [void]$newLines.Add("${indent}  .from(""bookings"")")
            [void]$newLines.Add("${indent}  .update(safePayload)")
            [void]$newLines.Add("${indent}  .eq(""id"", b.id);")
            [void]$newLines.Add("")
            [void]$newLines.Add("${indent}if (upErr) return NextResponse.json({ ok: false, error: ""DB_UPDATE_ERROR"", message: upErr.message }, { status: 500 });")
            [void]$newLines.Add("")
            [void]$newLines.Add("${indent}// Step 2: Try to set status='fare_proposed' (may fail if constraint blocks it)")
            [void]$newLines.Add("${indent}let statusWarning: string | null = null;")
            [void]$newLines.Add("${indent}const { error: statusErr } = await supabase")
            [void]$newLines.Add("${indent}  .from(""bookings"")")
            [void]$newLines.Add("${indent}  .update({ status: ""fare_proposed"" })")
            [void]$newLines.Add("${indent}  .eq(""id"", b.id);")
            [void]$newLines.Add("")
            [void]$newLines.Add("${indent}if (statusErr) {")
            [void]$newLines.Add("${indent}  console.warn(""FARE_PROPOSE_STATUS_BLOCKED"", statusErr.message);")
            [void]$newLines.Add("${indent}  statusWarning = ""STATUS_UPDATE_BLOCKED: "" + statusErr.message;")
            [void]$newLines.Add("${indent}}")

            # Skip the original block lines
            $i = $j - 1
            $patched = $true
            Write-Host "  PATCHED: Split into safe fare write + guarded status write" -ForegroundColor Green
            continue
        }
    }

    # Also patch the success response to include statusWarning if we patched
    if ($patched -and $line -match 'return\s+NextResponse\.json\(\s*\{\s*ok:\s*true') {
        # Look for the closing of this response
        $respLines = @($line)
        $j = $i + 1
        $braceDepth = ([regex]::Matches($line, '\{')).Count - ([regex]::Matches($line, '\}')).Count

        while ($j -lt $lines.Count -and $braceDepth -gt 0) {
            $respLines += $lines[$j]
            $braceDepth += ([regex]::Matches($lines[$j], '\{')).Count
            $braceDepth -= ([regex]::Matches($lines[$j], '\}')).Count
            $j++
        }

        $respText = $respLines -join "`n"
        
        # Add statusWarning to the response if not already present
        if ($respText -notmatch 'statusWarning') {
            # Insert statusWarning before the closing
            $respText = $respText -replace '(\}\s*,\s*\{\s*status:\s*200\s*\})', ', statusWarning $1'
            $newRespLines = $respText -split "`n"
            foreach ($rl in $newRespLines) {
                [void]$newLines.Add($rl)
            }
            $i = $j - 1
            continue
        }
    }

    [void]$newLines.Add($line)
}

if (-not $patched) {
    Write-Host ""
    Write-Host "WARNING: Could not find the expected .update() block with fare_proposed." -ForegroundColor Yellow
    Write-Host "The route structure may differ from expected pattern." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "MANUAL FIX REQUIRED:" -ForegroundColor Red
    Write-Host "  1. Open $target" -ForegroundColor Yellow
    Write-Host "  2. Find the .update() call that sets status: 'fare_proposed'" -ForegroundColor Yellow
    Write-Host "  3. Split it: first write proposed_fare only, then try status separately" -ForegroundColor Yellow
    Write-Host "  4. Or add 'fare_proposed' to bookings_status_check in the database" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "DATABASE FIX (if you have DB access):" -ForegroundColor Cyan
    Write-Host "  ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;" -ForegroundColor White
    Write-Host "  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check" -ForegroundColor White
    Write-Host "    CHECK (status IN ('requested','assigned','on_the_way','on_trip','completed','cancelled','fare_proposed','ready','arrived'));" -ForegroundColor White
    exit 0
}

$finalContent = $newLines -join "`n"

# --- Final validation ---
if ($finalContent -notmatch 'safePayload') {
    Write-Host "FATAL: Patched output missing safePayload. Patch logic error." -ForegroundColor Red
    exit 1
}
if ($finalContent -notmatch 'proposed_fare') {
    Write-Host "FATAL: Patched output missing proposed_fare reference." -ForegroundColor Red
    exit 1
}

# --- Write output ---
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($target, $finalContent, $utf8NoBom)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Script 3 COMPLETE" -ForegroundColor Green
Write-Host "  Target: $target" -ForegroundColor Green
Write-Host "  Backup: $bakFile" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "BEHAVIOR CHANGE:" -ForegroundColor Cyan
Write-Host "  - proposed_fare + driver_id are ALWAYS written (safe payload)" -ForegroundColor Cyan
Write-Host "  - status='fare_proposed' is attempted separately" -ForegroundColor Cyan
Write-Host "  - If status write is blocked by constraint, a warning is logged" -ForegroundColor Cyan
Write-Host "    but the fare data is preserved and the API returns 200 with statusWarning" -ForegroundColor Cyan
Write-Host ""
Write-Host "PREFERRED PERMANENT FIX (requires DB access):" -ForegroundColor Yellow
Write-Host "  Add 'fare_proposed' to bookings_status_check constraint:" -ForegroundColor Yellow
Write-Host "  ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;" -ForegroundColor Yellow
Write-Host "  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check" -ForegroundColor Yellow
Write-Host "    CHECK (status IN ('requested','assigned','on_the_way','on_trip','completed','cancelled','fare_proposed','ready','arrived'));" -ForegroundColor Yellow
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. npm run build" -ForegroundColor Yellow
Write-Host "  2. Test fare proposal from Android" -ForegroundColor Yellow
Write-Host "  3. Check if fare data is saved (proposed_fare column)" -ForegroundColor Yellow
Write-Host "  4. Check response for statusWarning field" -ForegroundColor Yellow
Write-Host "  5. If statusWarning present, apply the DB constraint fix above" -ForegroundColor Yellow
