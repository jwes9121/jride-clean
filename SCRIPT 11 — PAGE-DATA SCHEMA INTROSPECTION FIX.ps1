# ============================================================
# SCRIPT 11 — PAGE-DATA SCHEMA INTROSPECTION FIX
# ============================================================
# Problem D: getExistingColumns() queries information_schema.columns
#            via Supabase client, but Supabase client treats it as
#            a table in the public schema. The schema cache does not
#            contain information_schema tables, so every call fails:
#            "Could not find the table 'public.information_schema.columns'"
#
# Fix: Replace getExistingColumns() with a safe approach that
#      fetches one row with SELECT * and infers column names
#      from the returned object keys. Falls back to an empty set
#      if the table doesn't exist.
#
# Files affected:
#   app/api/admin/livetrips/page-data/route.ts
#
# RUN:
#   powershell -ExecutionPolicy Bypass -File .\public\jride-patches\script11-pagedata-schema-fix.ps1
# THEN:
#   npm run build / deploy
# ============================================================

$ErrorActionPreference = "Stop"
$repoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"

$target = Join-Path $repoRoot "app\api\admin\livetrips\page-data\route.ts"
if (-not (Test-Path $target)) {
    Write-Host "FATAL: page-data route not found at $target" -ForegroundColor Red
    exit 1
}

Write-Host "Found: $target" -ForegroundColor Green

# ---- backup ----
$ts     = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $repoRoot "_backups\pagedata"
if (-not (Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir -Force | Out-Null }
$bakFile = Join-Path $bakDir "route.ts.$ts.bak"
Copy-Item $target $bakFile -Force
Write-Host "BACKUP  $bakFile" -ForegroundColor Green

# ---- read ----
$content = [System.IO.File]::ReadAllText($target, [System.Text.UTF8Encoding]::new($false))

# ---- fingerprint ----
if ($content -notmatch 'getExistingColumns') {
    Write-Host "FATAL: getExistingColumns function not found" -ForegroundColor Red
    exit 1
}

if ($content -notmatch 'information_schema') {
    Write-Host "OK: information_schema reference already removed (may be already patched)" -ForegroundColor Green
    exit 0
}

# ---- replace getExistingColumns function ----
# Old function body uses .from("information_schema.columns")
# We replace the entire function with a safe alternative.

$oldFnPattern = '(?s)(async function getExistingColumns\([^)]*\)[^{]*\{).*?(\n\})'

$newFnBody = @'
async function getExistingColumns(supabase: ReturnType<typeof supabaseAdmin>, table: string): Promise<Set<string>> {
  // Safe column discovery: fetch one row with SELECT * and infer columns from keys.
  // This avoids querying information_schema which is not accessible via Supabase client.
  try {
    const { data, error } = await supabase.from(table).select("*").limit(1);
    if (error) {
      // Table might not exist — this is expected for optional tables like zones/dispatch_zones
      return new Set<string>();
    }
    if (!data || !data.length) {
      // Table exists but is empty — try a head request to get column info
      // Fall back to returning empty set; the caller will handle missing columns
      return new Set<string>();
    }
    return new Set<string>(Object.keys(data[0]).filter(Boolean));
  } catch (e: any) {
    console.error("getExistingColumns error for table:", table, e?.message);
    return new Set<string>();
  }
}
'@

if ($content -match $oldFnPattern) {
    $content = [regex]::Replace($content, $oldFnPattern, $newFnBody)
    Write-Host "REPLACED getExistingColumns with safe SELECT * approach" -ForegroundColor Green
} else {
    # Fallback: line-by-line replacement
    Write-Host "Regex match failed, trying line-by-line approach..." -ForegroundColor Yellow

    $lines = $content -split "`n"
    $rebuilt = [System.Collections.ArrayList]::new()
    $inFunction = $false
    $braceDepth = 0
    $replaced = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]

        if (-not $replaced -and $line -match 'async function getExistingColumns') {
            $inFunction = $true
            $braceDepth = 0
            # Add the new function
            foreach ($nl in ($newFnBody -split "`n")) {
                [void]$rebuilt.Add($nl)
            }
        }

        if ($inFunction) {
            foreach ($ch in $line.ToCharArray()) {
                if ($ch -eq '{') { $braceDepth++ }
                if ($ch -eq '}') { $braceDepth-- }
            }
            if ($braceDepth -le 0 -and $line -match '\}') {
                $inFunction = $false
                $replaced = $true
            }
            continue
        }

        [void]$rebuilt.Add($line)
    }

    if ($replaced) {
        $content = $rebuilt -join "`n"
        Write-Host "REPLACED getExistingColumns (line-by-line)" -ForegroundColor Green
    } else {
        Write-Host "FATAL: Could not replace getExistingColumns" -ForegroundColor Red
        exit 1
    }
}

# ---- validate ----
if ($content -match 'information_schema\.columns') {
    Write-Host "FATAL: information_schema.columns reference still present after patch" -ForegroundColor Red
    exit 1
}
if ($content -notmatch 'getExistingColumns') {
    Write-Host "FATAL: getExistingColumns function missing after patch" -ForegroundColor Red
    exit 1
}
if ($content -notmatch 'loadBookings') {
    Write-Host "FATAL: loadBookings missing — file may be corrupt" -ForegroundColor Red
    exit 1
}

# ---- write ----
[System.IO.File]::WriteAllText($target, $content, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Script 11 DONE  $target" -ForegroundColor Green
Write-Host "  Backup: $bakFile" -ForegroundColor Green
Write-Host "  Next: npm run build / deploy" -ForegroundColor Yellow
Write-Host "  Test: LiveTrips page-data should no longer log PAGE_DATA_SCHEMA_COLUMNS_ERROR" -ForegroundColor Yellow
Write-Host "  Test: zones / bookings columns should be discovered correctly" -ForegroundColor Yellow
