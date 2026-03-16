# ============================================================
# SCRIPT 1 — CLEAN REPAIR FOR app/api/dispatch/status/route.ts
# ============================================================
# Fixes duplicate normalizedStatus declaration and ensures
# accepted -> assigned normalization before DB write.
#
# RUN:
#   powershell -ExecutionPolicy Bypass -File .\public\jride-patches\script1-dispatch-status-repair.ps1
#
# THEN:
#   npm run build
# ============================================================

$ErrorActionPreference = "Stop"
$repoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$target = Join-Path $repoRoot "app\api\dispatch\status\route.ts"

if (-not (Test-Path $target)) {
    Write-Host "FATAL: Target file not found: $target" -ForegroundColor Red
    exit 1
}

# --- Timestamped backup ---
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $repoRoot "_backups\dispatch-status"
if (-not (Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir -Force | Out-Null }
$bakFile = Join-Path $bakDir "route.ts.$ts.bak"
Copy-Item -Path $target -Destination $bakFile -Force
Write-Host "BACKUP: $target -> $bakFile" -ForegroundColor Green

# --- Read current file ---
$content = [System.IO.File]::ReadAllText($target, [System.Text.UTF8Encoding]::new($false))
$lines = $content -split "`n"

Write-Host "Current file has $($lines.Count) lines." -ForegroundColor Cyan

# --- DIAGNOSTIC: Find all normalizedStatus declarations ---
$declLines = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*(let|const|var)\s+normalizedStatus\b') {
        $declLines += ($i + 1)
        Write-Host "  Found normalizedStatus declaration at line $($i + 1): $($lines[$i].Trim())" -ForegroundColor Yellow
    }
}

if ($declLines.Count -eq 0) {
    Write-Host "FATAL: No normalizedStatus declaration found. File structure unexpected." -ForegroundColor Red
    exit 1
}

if ($declLines.Count -gt 1) {
    Write-Host "CONFIRMED: $($declLines.Count) duplicate normalizedStatus declarations found at lines: $($declLines -join ', ')" -ForegroundColor Red
    Write-Host "Will remove all but the first and ensure correct normalization." -ForegroundColor Yellow
}

# --- STRATEGY ---
# 1. Keep only the FIRST normalizedStatus declaration block
# 2. Ensure it includes accepted -> assigned normalization
# 3. Remove any subsequent duplicate declarations + their if-blocks
# 4. Ensure all DB writes reference normalizedStatus (not raw status)

$newLines = [System.Collections.ArrayList]::new()
$firstDeclSeen = $false
$skipDuplicateBlock = $false

for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]

    # Detect normalizedStatus declaration
    if ($line -match '^\s*(let|const|var)\s+normalizedStatus\b') {
        if (-not $firstDeclSeen) {
            # First declaration — keep it, but ensure it's 'let' so we can reassign
            $firstDeclSeen = $true
            
            # Replace const with let if needed
            $fixedLine = $line -replace '^\s*const\s+normalizedStatus\b', '    let normalizedStatus'
            $fixedLine = $fixedLine -replace '^\s*var\s+normalizedStatus\b', '    let normalizedStatus'
            [void]$newLines.Add($fixedLine)

            # Check if the next lines already have the accepted -> assigned block
            $nextChunk = ""
            for ($j = $i + 1; $j -lt [Math]::Min($i + 5, $lines.Count); $j++) {
                $nextChunk += $lines[$j]
            }

            if ($nextChunk -notmatch 'normalizedStatus\s*===?\s*[''"]accepted[''"]') {
                # Need to inject normalization block right after this declaration
                [void]$newLines.Add('    if (normalizedStatus === "accepted") {')
                [void]$newLines.Add('      normalizedStatus = "assigned";')
                [void]$newLines.Add('    }')
                Write-Host "INJECTED: accepted -> assigned normalization after first declaration." -ForegroundColor Green
            } else {
                Write-Host "OK: accepted -> assigned normalization already present after first declaration." -ForegroundColor Green
            }
            continue
        } else {
            # Duplicate declaration — skip it and its following if-block
            Write-Host "REMOVING: duplicate normalizedStatus declaration at line $($i + 1)" -ForegroundColor Red
            $skipDuplicateBlock = $true
            continue
        }
    }

    # If we're skipping a duplicate block, also skip the if (normalizedStatus === "accepted") block
    if ($skipDuplicateBlock) {
        if ($line -match '^\s*if\s*\(\s*normalizedStatus\s*===?\s*[''"]accepted[''"]') {
            # Skip this line and the next 2 lines (the assignment and closing brace)
            Write-Host "REMOVING: duplicate accepted->assigned if-block at line $($i + 1)" -ForegroundColor Red
            # Skip ahead past the closing brace
            $braceCount = 0
            for ($k = $i; $k -lt $lines.Count; $k++) {
                if ($lines[$k] -match '\{') { $braceCount++ }
                if ($lines[$k] -match '\}') { 
                    $braceCount-- 
                    if ($braceCount -le 0) {
                        $i = $k
                        break
                    }
                }
            }
            $skipDuplicateBlock = $false
            continue
        }

        # If next meaningful line isn't the if-block, stop skipping
        if ($line.Trim() -ne "") {
            $skipDuplicateBlock = $false
        } else {
            # Skip blank lines between duplicate decl and its if-block
            continue
        }
    }

    [void]$newLines.Add($line)
}

# --- VALIDATION: Check that normalizedStatus is used in updatePayload ---
$joined = $newLines -join "`n"

# Verify: status field in updatePayload should reference normalizedStatus
if ($joined -match 'status:\s*status[^A-Za-z]' -and $joined -notmatch 'status:\s*normalizedStatus') {
    Write-Host "WARNING: updatePayload uses raw 'status' instead of 'normalizedStatus'. Patching..." -ForegroundColor Yellow
    $patched = [System.Collections.ArrayList]::new()
    foreach ($ln in $newLines) {
        if ($ln -match '^\s*status:\s*status\s*,' -or $ln -match '^\s*status:\s*status\s*$') {
            $fixed = $ln -replace 'status:\s*status', 'status: normalizedStatus'
            [void]$patched.Add($fixed)
            Write-Host "  FIXED: $($ln.Trim()) -> $($fixed.Trim())" -ForegroundColor Green
        } else {
            [void]$patched.Add($ln)
        }
    }
    $newLines = $patched
}

# --- VALIDATION: Verify error responses also use normalizedStatus ---
$finalContent = $newLines -join "`n"

# Count normalizedStatus references (should be multiple)
$refCount = ([regex]::Matches($finalContent, 'normalizedStatus')).Count
Write-Host "normalizedStatus references in output: $refCount" -ForegroundColor Cyan

$declCount = ([regex]::Matches($finalContent, '(let|const|var)\s+normalizedStatus')).Count
if ($declCount -ne 1) {
    Write-Host "FATAL: Expected exactly 1 normalizedStatus declaration, found $declCount. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host "VALIDATED: Exactly 1 normalizedStatus declaration." -ForegroundColor Green

# --- Verify content fingerprint ---
if ($finalContent -notmatch 'bookings') {
    Write-Host "FATAL: Output missing 'bookings' reference. Content fingerprint mismatch." -ForegroundColor Red
    exit 1
}
if ($finalContent -notmatch 'DISPATCH_STATUS') {
    Write-Host "FATAL: Output missing 'DISPATCH_STATUS' marker. Content fingerprint mismatch." -ForegroundColor Red
    exit 1
}
if ($finalContent -notmatch '"assigned"') {
    Write-Host "FATAL: Output missing 'assigned' string. Normalization may be broken." -ForegroundColor Red
    exit 1
}

# --- Write output ---
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($target, $finalContent, $utf8NoBom)

Write-Host "" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Script 1 COMPLETE" -ForegroundColor Green
Write-Host "  Target: $target" -ForegroundColor Green
Write-Host "  Backup: $bakFile" -ForegroundColor Green
Write-Host "  Declarations: $declCount (must be 1)" -ForegroundColor Green
Write-Host "  References: $refCount" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. npm run build" -ForegroundColor Yellow
Write-Host "  2. Test: POST /api/dispatch/status with status='accepted'" -ForegroundColor Yellow
Write-Host "     -> Should write 'assigned' to DB, not 'accepted'" -ForegroundColor Yellow
Write-Host "  3. Verify existing lifecycle still works:" -ForegroundColor Yellow
Write-Host "     assigned -> on_the_way -> on_trip -> completed" -ForegroundColor Yellow
