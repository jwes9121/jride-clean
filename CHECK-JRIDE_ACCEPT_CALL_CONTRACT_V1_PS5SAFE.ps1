param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh",
  [string]$AndroidRoot = "C:\Users\jwes9\AndroidStudioProjects\JRideApp"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$Path) {
  if (!(Test-Path $Path)) { throw "Missing file: $Path" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Find-Files([string]$Root, [string[]]$Patterns) {
  $all = Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue
  $out = @()
  foreach ($f in $all) {
    foreach ($p in $Patterns) {
      if ($f.Name -like $p) {
        $out += $f.FullName
        break
      }
    }
  }
  return $out | Sort-Object -Unique
}

function Show-Matches {
  param(
    [string]$Title,
    [string]$Text,
    [string]$Pattern
  )

  Write-Host ""
  Write-Host ("=" * 110) -ForegroundColor DarkGray
  Write-Host $Title -ForegroundColor Cyan
  Write-Host ("=" * 110) -ForegroundColor DarkGray

  $matches = [regex]::Matches($Text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($matches.Count -eq 0) {
    Write-Host "[NO MATCH]" -ForegroundColor Yellow
    return
  }

  $i = 0
  foreach ($m in $matches) {
    $i++
    Write-Host ("--- MATCH #" + $i) -ForegroundColor Green
    Write-Host $m.Value
    Write-Host ""
  }
}

Write-Host "== CHECK JRIDE ACCEPT CALL CONTRACT V1 (PS5-safe) =="

$webStatus = Join-Path $WebRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path $webStatus)) { throw "Missing web route: $webStatus" }

$androidCandidates = Find-Files -Root $AndroidRoot -Patterns @("*.kt", "*.java")

Write-Host ""
Write-Host "WEB ROUTE:" -ForegroundColor Magenta
Write-Host $webStatus

$webText = Read-Text $webStatus

Show-Matches -Title "1) dispatch/status accepted contract" `
  -Text $webText `
  -Pattern '(?s)type\s+Body\s*=\s*\{[\s\S]{0,1200}?\}'

Show-Matches -Title "2) dispatch/status field extraction" `
  -Text $webText `
  -Pattern '(?s)const\s+bookingId\s*=.*?const\s+status\s*=.*?let\s+normalizedStatus\s*=.*?(if\s*\(\s*normalizedStatus\s*===\s*"accepted".*?\})?'

Show-Matches -Title "3) dispatch/status missing identifier / missing status checks" `
  -Text $webText `
  -Pattern '(?s)if\s*\(\s*!status\s*\).*?if\s*\(\s*!bookingId\s*&&\s*!bookingCode\s*\).*?'

Show-Matches -Title "4) dispatch/status update payload" `
  -Text $webText `
  -Pattern '(?s)const\s+updatePayload.*?;\s*if\s*\(\s*driverId\s*\).*?\}'

# Android search targets
$needles = @(
  'updateTripStatusAsync',
  '/api/dispatch/status',
  'dispatch/status',
  'accepted',
  'bookingCode',
  'booking_code',
  'bookingId',
  'booking_id',
  'driver_id',
  'onAcceptTrip',
  'btnTripAccept',
  'LiveLocationClient'
)

foreach ($file in $androidCandidates) {
  try {
    $text = Read-Text $file
    $hit = $false
    foreach ($n in $needles) {
      if ($text -match [regex]::Escape($n)) {
        $hit = $true
        break
      }
    }
    if ($hit) {
      Write-Host ""
      Write-Host ("FILE: " + $file) -ForegroundColor Magenta

      Show-Matches -Title "A) onAcceptTrip / accept handler" `
        -Text $text `
        -Pattern '(?s)(fun\s+onAcceptTrip\s*\([^)]*\)\s*\{[\s\S]{0,5000}?\n\}|btnTripAccept[\s\S]{0,2500})'

      Show-Matches -Title "B) updateTripStatusAsync / dispatch status call" `
        -Text $text `
        -Pattern '(?s)(updateTripStatusAsync[\s\S]{0,5000}?\n\}|/api/dispatch/status[\s\S]{0,2500})'

      Show-Matches -Title "C) accepted payload fields" `
        -Text $text `
        -Pattern '(?s).{0,250}(accepted).{0,1200}(bookingCode|booking_code|bookingId|booking_id|driver_id).{0,1200}'

      Show-Matches -Title "D) JSON body for accept call" `
        -Text $text `
        -Pattern '(?s)(JSONObject\(\)[\s\S]{0,1500}(bookingCode|booking_code|bookingId|booking_id|driver_id|status)[\s\S]{0,1500})'
    }
  } catch {}
}