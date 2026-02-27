param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function TS() { Get-Date -Format "yyyyMMdd_HHmmss" }

if (-not (Test-Path -LiteralPath $ProjRoot)) {
  throw "ProjRoot not found: $ProjRoot"
}

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
$stamp = TS
$outDir = Join-Path $root ("_diag_out_verification_scan_" + $stamp)
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$summaryPath = Join-Path $outDir "SUMMARY.txt"
$hitsCsvPath = Join-Path $outDir "HITS.csv"
$hitsTxtPath = Join-Path $outDir "HITS.txt"
$pathsTxtPath = Join-Path $outDir "KEY_PATHS.txt"

"== JRIDE SCAN: Verification + Booking Entrypoints (V2 / PS5-safe) ==" | Out-File -Encoding UTF8 $summaryPath
("Root: " + $root) | Out-File -Encoding UTF8 -Append $summaryPath
("Out : " + $outDir) | Out-File -Encoding UTF8 -Append $summaryPath
"" | Out-File -Encoding UTF8 -Append $summaryPath

# File extensions to scan
$exts = @("*.ts","*.tsx","*.js","*.jsx","*.mjs","*.cjs","*.sql","*.md")
$allFiles = New-Object System.Collections.Generic.List[string]

foreach ($e in $exts) {
  Get-ChildItem -LiteralPath $root -Recurse -File -Filter $e -ErrorAction SilentlyContinue |
    ForEach-Object { $allFiles.Add($_.FullName) }
}

# Exclude typical bulky folders
$excludeParts = @(
  "\node_modules\",
  "\.next\",
  "\_diag_out_",
  "\dist\",
  "\build\",
  "\.git\",
  "\android\app\build\",
  "\ios\Pods\"
)

function IsExcluded([string]$p) {
  foreach ($x in $excludeParts) {
    if ($p -like "*$x*") { return $true }
  }
  return $false
}

$scanFiles = $allFiles | Where-Object { -not (IsExcluded $_) }

("Files scanned: " + $scanFiles.Count) | Out-File -Encoding UTF8 -Append $summaryPath

# Patterns (high-signal)
$patterns = @(
  'passenger_verification_requests',
  'app/api/public/passenger/verification/request',
  'admin/verification',
  '"/api/admin/verification',
  "status\s*:\s*['""]submitted['""]",
  "status\s*:\s*['""]pending_admin['""]",
  "status\s*:\s*['""]approved['""]",
  "status\s*:\s*['""]rejected['""]",
  "['""]submitted['""]",
  "['""]pending_admin['""]",
  "['""]approved['""]",
  "['""]rejected['""]",
  '\.from\(["'']passenger_verification_requests["'']\)',
  '\.insert\(',
  '\.update\(',
  '\.select\(',
  'bookings',
  'dispatch/bookings',
  'takeout',
  'vendor-orders',
  'night_allowed',
  'verified'
)

# Collect hits
$hitRows = New-Object System.Collections.Generic.List[object]

foreach ($file in $scanFiles) {
  try {
    $content = Get-Content -LiteralPath $file -Raw -ErrorAction Stop
  } catch {
    continue
  }

  foreach ($pat in $patterns) {
    try {
      $ms = [regex]::Matches($content, $pat, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
      if ($ms.Count -gt 0) {
        foreach ($m in $ms) {
          # compute line number by counting newlines up to index
          $prefix = $content.Substring(0, [Math]::Min($m.Index, $content.Length))
          $line = ($prefix.Split("`n").Count)
          $ctxStart = [Math]::Max(0, $m.Index - 80)
          $ctxLen = [Math]::Min(200, $content.Length - $ctxStart)
          $ctx = $content.Substring($ctxStart, $ctxLen).Replace("`r","").Replace("`n"," ").Trim()

          $hitRows.Add([pscustomobject]@{
            File = $file
            Line = $line
            Pattern = $pat
            Match = $m.Value
            Context = $ctx
          }) | Out-Null
        }
      }
    } catch {
      # ignore bad regex edge cases
    }
  }
}

# Write outputs
$hitRows |
  Sort-Object File, Line |
  Export-Csv -NoTypeInformation -Encoding UTF8 -Path $hitsCsvPath

$hitRows |
  Sort-Object File, Line |
  ForEach-Object {
    ("{0}:{1}  [{2}]  {3}" -f $_.File, $_.Line, $_.Pattern, $_.Context)
  } | Out-File -Encoding UTF8 $hitsTxtPath

# Extract key paths summary
$keyPaths = @(
  "app\api\public\passenger\verification\request\route.ts",
  "app\api\admin\verification\pending\route.ts",
  "app\api\admin\verification\forward\route.ts",
  "app\api\admin\verification\decide\route.ts",
  "app\api\dispatch\bookings\route.ts",
  "app\api\vendor-orders\route.ts"
)

"== KEY PATH PRESENCE ==" | Out-File -Encoding UTF8 $pathsTxtPath
foreach ($kp in $keyPaths) {
  $abs = Join-Path $root $kp
  if (Test-Path -LiteralPath $abs) {
    ("[OK] " + $kp) | Out-File -Encoding UTF8 -Append $pathsTxtPath
  } else {
    ("[MISS] " + $kp) | Out-File -Encoding UTF8 -Append $pathsTxtPath
  }
}

"" | Out-File -Encoding UTF8 -Append $summaryPath
("Hits: " + $hitRows.Count) | Out-File -Encoding UTF8 -Append $summaryPath
("Saved: " + $hitsCsvPath) | Out-File -Encoding UTF8 -Append $summaryPath
("Saved: " + $hitsTxtPath) | Out-File -Encoding UTF8 -Append $summaryPath
("Saved: " + $pathsTxtPath) | Out-File -Encoding UTF8 -Append $summaryPath

Write-Host "== DONE =="
Write-Host ("OutDir: " + $outDir)
Write-Host ("Hits  : " + $hitRows.Count)
Write-Host ("CSV   : " + $hitsCsvPath)
Write-Host ("TXT   : " + $hitsTxtPath)
Write-Host ("KEYS  : " + $pathsTxtPath)