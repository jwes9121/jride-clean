param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host ("=" * 100)
  Write-Host $Title
  Write-Host ("=" * 100)
}

function Get-ScanFiles {
  param([string]$Root)

  Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
      $_.FullName -notmatch "\\node_modules\\|\\\.next\\|\\dist\\|\\build\\|\\coverage\\|\\out\\|\\\.git\\"
    } |
    Where-Object {
      @(".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",".md",".sql") -contains $_.Extension.ToLowerInvariant() `
      -or $_.Name -eq ".env" `
      -or $_.Name -eq ".env.local" `
      -or $_.Name -like ".env.*"
    }
}

function Show-Matches {
  param(
    [string]$Root,
    [string]$Title,
    [string[]]$Patterns
  )

  Write-Section $Title

  $files = @(Get-ScanFiles -Root $Root)
  if ($files.Count -eq 0) {
    Write-Host "[NO FILES FOUND]"
    return
  }

  $matches = Select-String -Path ($files.FullName) -Pattern $Patterns -SimpleMatch -CaseSensitive:$false -ErrorAction SilentlyContinue

  if (-not $matches) {
    Write-Host "[NONE FOUND]"
    return
  }

  $matches |
    Select-Object Path, LineNumber, Line |
    Format-Table -AutoSize
}

function Show-TopFiles {
  param(
    [string]$Root,
    [string[]]$Patterns
  )

  Write-Section "6. BEST CANDIDATE FILES TO INSPECT"

  $files = @(Get-ScanFiles -Root $Root)
  $matches = Select-String -Path ($files.FullName) -Pattern $Patterns -SimpleMatch -CaseSensitive:$false -ErrorAction SilentlyContinue

  if (-not $matches) {
    Write-Host "[NONE FOUND]"
    return
  }

  $matches |
    Group-Object Path |
    Sort-Object Count -Descending |
    Select-Object -First 15 |
    ForEach-Object {
      "{0}  (hits: {1})" -f $_.Name, $_.Count
    }
}

function Show-Snippet {
  param(
    [string]$FilePath,
    [int]$LineNumber,
    [int]$Radius = 8
  )

  if (!(Test-Path $FilePath)) { return }

  $lines = Get-Content -LiteralPath $FilePath -Encoding UTF8
  $start = [Math]::Max(1, $LineNumber - $Radius)
  $end = [Math]::Min($lines.Count, $LineNumber + $Radius)

  Write-Host ""
  Write-Host ("--- FILE SNIPPET: " + $FilePath + " @ line " + $LineNumber + " ---")

  for ($n = $start; $n -le $end; $n++) {
    $prefix = $n.ToString().PadLeft(5, " ")
    Write-Host ($prefix + ": " + $lines[$n - 1])
  }
}

if (!(Test-Path $WebRoot)) {
  throw "WebRoot not found: $WebRoot"
}

$reportPath = Join-Path $WebRoot ("JRIDE_WEB_AUTH_TRACK_DIAG_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".txt")
Start-Transcript -Path $reportPath -Force | Out-Null

$allPatterns = @(
  "/api/public/passenger/book",
  "/api/passenger/book",
  "/api/public/passenger/booking",
  "/api/passenger/booking",
  "/api/public/passenger/track",
  "/api/passenger/track",
  "Authorization",
  "Bearer",
  "access_token",
  "accessToken",
  "supabase.auth",
  "getSession(",
  "getUser(",
  "fetch(",
  "axios.post",
  "axios.get",
  "method: 'POST'",
  'method: "POST"',
  "handleSubmit",
  "onSubmit",
  "Book Ride",
  "bookRide",
  "submitBooking",
  "fees_acknowledged",
  "pickup_lat",
  "dropoff_lat",
  "haversine",
  "trip_distance_km",
  "driver_to_pickup_km"
)

Write-Section "JRIDE WEB BOOKING / AUTH / TRACK DIAGNOSTIC"
Write-Host "WebRoot: $WebRoot"
Write-Host "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

Show-Matches -Root $WebRoot -Title "1. BOOKING POST CALLERS" -Patterns @(
  "/api/public/passenger/book",
  "/api/passenger/book",
  "fetch(",
  "axios.post",
  "method: 'POST'",
  'method: "POST"'
)

Show-Matches -Root $WebRoot -Title "2. AUTHORIZATION / BEARER TOKEN USAGE" -Patterns @(
  "Authorization",
  "Bearer",
  "access_token",
  "accessToken",
  "supabase.auth",
  "getSession(",
  "getUser("
)

Show-Matches -Root $WebRoot -Title "3. OLD PASSENGER READ PATHS" -Patterns @(
  "/api/public/passenger/booking",
  "/api/passenger/booking",
  "/api/public/passenger/track",
  "/api/passenger/track"
)

Show-Matches -Root $WebRoot -Title "4. CLIENT-SIDE DISTANCE / ETA COMPUTATION" -Patterns @(
  "haversine",
  "trip_distance_km",
  "driver_to_pickup_km",
  "ETA",
  "eta"
)

Show-Matches -Root $WebRoot -Title "5. SUBMIT HANDLERS / FORM LOGIC" -Patterns @(
  "handleSubmit",
  "onSubmit",
  "Book Ride",
  "bookRide",
  "submitBooking",
  "fees_acknowledged",
  "pickup_lat",
  "dropoff_lat"
)

Show-TopFiles -Root $WebRoot -Patterns $allPatterns

Write-Section "7. SNIPPETS FOR TOP MATCHES"
$files = @(Get-ScanFiles -Root $WebRoot)
$topMatches = Select-String -Path ($files.FullName) -Pattern $allPatterns -SimpleMatch -CaseSensitive:$false -ErrorAction SilentlyContinue |
  Select-Object -First 8

if ($topMatches) {
  foreach ($m in $topMatches) {
    Show-Snippet -FilePath $m.Path -LineNumber $m.LineNumber -Radius 8
  }
} else {
  Write-Host "[NONE FOUND]"
}

Write-Section "8. OUTPUT FILE"
Write-Host $reportPath

Stop-Transcript | Out-Null
Write-Host ""
Write-Host "[DONE] Diagnostic report written to:"
Write-Host $reportPath