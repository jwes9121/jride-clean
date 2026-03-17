param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$Path) {
  if (!(Test-Path $Path)) { throw "Missing file: $Path" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Show-Match {
  param(
    [string]$Label,
    [string]$Text,
    [string]$Pattern
  )

  Write-Host ""
  Write-Host ("=" * 100) -ForegroundColor DarkGray
  Write-Host $Label -ForegroundColor Cyan
  Write-Host ("=" * 100) -ForegroundColor DarkGray

  $m = [regex]::Match($Text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($m.Success) {
    Write-Host $m.Value
  } else {
    Write-Host "[NO MATCH]" -ForegroundColor Yellow
  }
}

$bookFile   = Join-Path $WebRoot "app\api\public\passenger\book\route.ts"
$assignFile = Join-Path $WebRoot "app\api\dispatch\assign\route.ts"

$bookText   = Read-Text $bookFile
$assignText = Read-Text $assignFile

Write-Host "== CHECK JRIDE BOOK / ASSIGN MISMATCH V1 =="

Show-Match -Label "1) passenger book route internal dispatch call" `
  -Text $bookText `
  -Pattern 'fetch\(\s*`\$\{baseUrl\}/api/dispatch/assign`[\s\S]{0,1200}?\)\s*;?'

Show-Match -Label "2) booking payload sent to dispatch/assign" `
  -Text $bookText `
  -Pattern 'assignPayload\s*=\s*\{[\s\S]{0,300}?\}|body:\s*JSON\.stringify\(\s*\{[\s\S]{0,300}?booking_id[\s\S]{0,300}?\}\s*\)'

Show-Match -Label "3) assign route driverId extraction" `
  -Text $assignText `
  -Pattern 'const\s+driverId\s*=.*'

Show-Match -Label "4) assign route missing driver guard" `
  -Text $assignText `
  -Pattern 'if\s*\(\s*!driverId\s*\)[\s\S]{0,300}'

Show-Match -Label "5) assign route booking update payload" `
  -Text $assignText `
  -Pattern 'const\s+updatePayload\s*=\s*\{[\s\S]{0,1200}?\}'