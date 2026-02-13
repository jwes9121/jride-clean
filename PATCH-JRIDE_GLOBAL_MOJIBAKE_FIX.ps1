$ErrorActionPreference = "Stop"

function WriteUtf8NoBom([string]$path, [string]$text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

function CountMarkers([string]$s) {
  # mojibake usually contains these marker characters when UTF-8 was mis-decoded as Win-1252 then saved
  $c = 0
  foreach ($ch in $s.ToCharArray()) {
    $code = [int][char]$ch
    if ($code -eq 0x00C3 -or $code -eq 0x00C2 -or $code -eq 0x00E2) { $c++ } # Ã, , â
  }
  return $c
}

function RecodeWin1252ToUtf8([string]$s) {
  $enc1252 = [System.Text.Encoding]::GetEncoding(1252)
  $utf8 = [System.Text.Encoding]::UTF8
  # take the *characters* as if they were Win-1252 bytes, then decode as UTF-8
  $bytes = $enc1252.GetBytes($s)
  return $utf8.GetString($bytes)
}

$files = Get-ChildItem -Path "app" -Recurse -File -Include *.ts,*.tsx

$fixed = 0
foreach ($f in $files) {
  $path = $f.FullName
  $orig = Get-Content -LiteralPath $path -Raw

  $m0 = CountMarkers $orig
  if ($m0 -le 0) { continue }

  $cand = RecodeWin1252ToUtf8 $orig
  $m1 = CountMarkers $cand

  # Accept ONLY if it improves markers AND it actually changes
  if ($cand -ne $orig -and $m1 -lt $m0) {
    $bak = "$path.bak.$(Get-Date -Format yyyyMMdd_HHmmss)"
    Copy-Item -LiteralPath $path -Destination $bak -Force
    WriteUtf8NoBom $path $cand
    Write-Host "[FIXED] $path (markers $m0 -> $m1)"
    $fixed++
  }
}

Write-Host ""
Write-Host ("Done. Files fixed: {0}" -f $fixed)
