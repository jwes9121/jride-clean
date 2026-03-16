param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Show-Block {
  param(
    [string]$Label,
    [string]$Text,
    [string]$Pattern
  )
  $m = [regex]::Match($Text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  Write-Host ""
  Write-Host ("=" * 90) -ForegroundColor DarkGray
  Write-Host $Label -ForegroundColor Cyan
  Write-Host ("=" * 90) -ForegroundColor DarkGray
  if ($m.Success) {
    Write-Host $m.Value
  } else {
    Write-Host "[NOT FOUND]" -ForegroundColor Yellow
  }
}

$routePath = Join-Path $WebRoot "app\api\public\passenger\book\route.ts"
$text = Read-Text $routePath

Write-Host "ROUTE FILE: $routePath" -ForegroundColor Green

Show-Block -Label "IMPORTS / HELPER REFERENCES FOR getBaseUrlFromHeaders" `
  -Text $text `
  -Pattern 'import[\s\S]{0,2000}?getBaseUrlFromHeaders[\s\S]{0,800}?;'

Show-Block -Label "INLINE FUNCTION getBaseUrlFromHeaders IN ROUTE FILE" `
  -Text $text `
  -Pattern 'function\s+getBaseUrlFromHeaders[\s\S]{0,3000}?\n\}'

Show-Block -Label "CONST/ARROW FUNCTION getBaseUrlFromHeaders IN ROUTE FILE" `
  -Text $text `
  -Pattern '(const|let)\s+getBaseUrlFromHeaders\s*=\s*(async\s*)?\([\s\S]{0,3000}?\n\};?'

Write-Host ""
Write-Host ("=" * 90) -ForegroundColor DarkGray
Write-Host "SEARCHING ENTIRE REPO FOR getBaseUrlFromHeaders" -ForegroundColor Cyan
Write-Host ("=" * 90) -ForegroundColor DarkGray

$hits = Get-ChildItem -Path $WebRoot -Recurse -File -Include *.ts,*.tsx |
  Where-Object {
    $_.FullName -notmatch "\\node_modules\\" -and
    $_.FullName -notmatch "\\\.next\\" -and
    $_.FullName -notmatch "\\_patch_bak\\" -and
    $_.FullName -notmatch "\\backups\\" -and
    $_.FullName -notmatch "\\_diag_" -and
    $_.FullName -notmatch "\\_zip_"
  } |
  ForEach-Object {
    try {
      $content = Read-Text $_.FullName
      if ($content -match 'getBaseUrlFromHeaders') {
        [pscustomobject]@{
          Path = $_.FullName
          Content = $content
        }
      }
    } catch {}
  }

if (!$hits) {
  Write-Host "[NO HITS]" -ForegroundColor Yellow
  exit 0
}

$hits | ForEach-Object {
  Write-Host ""
  Write-Host ("FILE: " + $_.Path) -ForegroundColor Magenta

  Show-Block -Label "MATCH BLOCK: getBaseUrlFromHeaders reference/definition" `
    -Text $_.Content `
    -Pattern 'getBaseUrlFromHeaders[\s\S]{0,3500}?(\n\}|\n\};|\nexport|\nconst|\nlet|\nasync function|$)'
}