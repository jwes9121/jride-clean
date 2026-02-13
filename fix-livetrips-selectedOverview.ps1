$path = "C:\Users\jwes9\Desktop\fix-livetrips-selectedOverview.ps1"
@'
$ErrorActionPreference = "Stop"

$ROOT = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$FILE = Join-Path $ROOT "app\admin\livetrips\components\LiveTripsMap.tsx"
if (!(Test-Path $FILE)) { throw "Missing: $FILE" }

# backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $FILE "$FILE.bak_$stamp" -Force
Write-Host "Backup: $FILE.bak_$stamp" -ForegroundColor DarkGray

$c = Get-Content $FILE -Raw

# If already wrapped, skip
if ($c -match "selectedOverview\s*=\s*useMemo\(\(\)\s*=>\s*\{\s*[\s\S]*?try\s*\{") {
  Write-Host "selectedOverview already has try/catch. Skipping." -ForegroundColor Yellow
  exit 0
}

# Insert try { after selectedOverview memo start
$rxOpen = New-Object System.Text.RegularExpressions.Regex(
  "(const\s+selectedOverview\s*=\s*useMemo\(\(\)\s*=>\s*\{\s*\r?\n)",
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)
if (-not $rxOpen.IsMatch($c)) { throw "Could not find selectedOverview useMemo opening." }
$c = $rxOpen.Replace($c, "`$1  try {`r`n", 1)

# Find the first "}, [" after selectedOverview and inject catch before it
$idx = $c.IndexOf("const selectedOverview")
if ($idx -lt 0) { throw "selectedOverview marker not found after modification." }

$head = $c.Substring(0, $idx)
$tail = $c.Substring($idx)

$rxClose = New-Object System.Text.RegularExpressions.Regex(
  "(\r?\n\s*\}\s*,\s*\[\s*)",
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

$mClose = $rxClose.Match($tail)
if (!$mClose.Success) { throw "Could not find selectedOverview dependency close pattern (}, [ ...])." }

$catchBlock = @"
  } catch (e) {
    console.error(""[LiveTripsMap] selectedOverview crashed:"", e);
    return null;
  }

"@

$tail2 = $rxClose.Replace($tail, "`r`n$catchBlock`$1", 1)
$c2 = $head + $tail2

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($FILE, $c2, $utf8NoBom)

Write-Host "Applied circuit breaker to selectedOverview." -ForegroundColor Green
Write-Host "DONE. Restart: npm run dev" -ForegroundColor Cyan

Write-Host "`nPress Enter to close..." -ForegroundColor DarkGray
Read-Host | Out-Null
'@ | Set-Content -Encoding UTF8 $path

Write-Host "Created script: $path" -ForegroundColor Green
