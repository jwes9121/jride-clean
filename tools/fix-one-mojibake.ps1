param(
  [Parameter(Mandatory=$true)]
  [string]$Path
)

function Fail($m){
  Write-Host "[FAIL] $m" -ForegroundColor Red
  exit 1
}

$resolved = Resolve-Path $Path -ErrorAction SilentlyContinue
if (-not $resolved) { Fail "File not found: $Path" }
$file = $resolved.Path

# Read bytes as ISO-8859-1 then re-save as UTF-8 (classic mojibake fix)
$bytes = [System.IO.File]::ReadAllBytes($file)
$text  = [System.Text.Encoding]::GetEncoding("ISO-8859-1").GetString($bytes)

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "$file.bak_$stamp"
Copy-Item $file $backup -Force

# Write UTF-8 without BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($file, $text, $utf8)

Write-Host "[OK] Mojibake normalized:" -ForegroundColor Green
Write-Host "     $file"
Write-Host "     Backup: $backup" -ForegroundColor DarkGray
