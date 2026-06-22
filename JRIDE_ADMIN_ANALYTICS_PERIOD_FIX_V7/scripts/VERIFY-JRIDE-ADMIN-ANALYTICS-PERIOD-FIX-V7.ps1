
Write-Host "JRIDE ADMIN ANALYTICS PERIOD FIX V7 - VERIFY"

$Target = ".\app\api\admin\analytics\trips\route.ts"

$Markers = @(
  'timeZone: "Asia/Manila"',
  'startOfTodayLocal',
  'startOfWeekLocal',
  'startOfMonthLocal'
)

$Content = Get-Content $Target -Raw

foreach ($Marker in $Markers) {
  if ($Content -notlike "*$Marker*") {
    throw "Missing marker: $Marker"
  }
}

Write-Host "VERIFY OK"
