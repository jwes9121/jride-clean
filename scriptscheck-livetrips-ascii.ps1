param(
  [string]$ProjRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$proj = (Resolve-Path $ProjRoot).Path
$ltDir = Join-Path $proj "app\admin\livetrips"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Strip-NonAscii {
    param([string]$text)

    $chars = $text.ToCharArray() | Where-Object {
        [int]$_ -lt 128
    }

    -join $chars
}

$files = Get-ChildItem $ltDir -Recurse -File -Include *.ts,*.tsx

foreach ($file in $files) {

    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $text  = [System.Text.Encoding]::UTF8.GetString($bytes)

    $clean = Strip-NonAscii $text

    if ($clean -ne $text) {
        Write-Host "Sanitized: $($file.FullName)" -ForegroundColor Green
        [System.IO.File]::WriteAllBytes(
            $file.FullName,
            $utf8NoBom.GetBytes($clean)
        )
    }
}