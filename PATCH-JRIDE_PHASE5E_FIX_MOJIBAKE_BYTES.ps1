$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

if (!(Test-Path ".\package.json")) { Fail "Run from repo root (package.json missing)." }
if (!(Test-Path ".\app")) { Fail "Expected ./app folder." }

$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")

$targets = @(
  ".\app\passenger\page.tsx",
  ".\app\passenger-login\page.tsx",
  ".\app\passenger-signup\page.tsx"
) | Where-Object { Test-Path $_ }

if ($targets.Count -eq 0) { Fail "No target files found: app/passenger, passenger-login, passenger-signup." }

function Replace-Bytes([byte[]]$data, [byte[]]$find, [byte[]]$repl) {
  # simple scan/replace
  $ms = New-Object System.IO.MemoryStream
  $i = 0
  while ($i -lt $data.Length) {
    $match = $true
    if ($i + $find.Length -le $data.Length) {
      for ($j = 0; $j -lt $find.Length; $j++) {
        if ($data[$i + $j] -ne $find[$j]) { $match = $false; break }
      }
    } else {
      $match = $false
    }

    if ($match) {
      $ms.Write($repl, 0, $repl.Length) | Out-Null
      $i += $find.Length
    } else {
      $ms.WriteByte($data[$i])
      $i++
    }
  }
  return $ms.ToArray()
}

# UTF-8 bytes for common punctuation that turns into "mojibake" when mis-decoded somewhere
# en dash: E2 80 93, em dash: E2 80 94, ellipsis: E2 80 A6
# left/right single quotes: E2 80 98 / E2 80 99
# left/right double quotes: E2 80 9C / E2 80 9D
$replacements = @(
  @{ find = [byte[]](0xE2,0x80,0x93); repl = [byte[]](0x2D) }, # –
  @{ find = [byte[]](0xE2,0x80,0x94); repl = [byte[]](0x2D) }, # —
  @{ find = [byte[]](0xE2,0x80,0xA6); repl = [byte[]](0x2E,0x2E,0x2E) }, # …
  @{ find = [byte[]](0xE2,0x80,0x98); repl = [byte[]](0x27) }, # ‘
  @{ find = [byte[]](0xE2,0x80,0x99); repl = [byte[]](0x27) }, # ’
  @{ find = [byte[]](0xE2,0x80,0x9C); repl = [byte[]](0x22) }, # “
  @{ find = [byte[]](0xE2,0x80,0x9D); repl = [byte[]](0x22) }  # ”
)

foreach ($path in $targets) {
  Copy-Item $path "$path.bak.$ts" -Force
  Ok "[OK] Backup: $path.bak.$ts"

  $bytes = [System.IO.File]::ReadAllBytes($path)
  $origLen = $bytes.Length

  foreach ($r in $replacements) {
    $bytes = Replace-Bytes $bytes $r.find $r.repl
  }

  # Extra: force "8PM-5AM" if the file contains "8PM" then any dash byte (after replacements)
  # (No harm if it's already correct.)
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  $text2 = $text -replace '8PM\s*-\s*5AM', '8PM-5AM'
  $text2 = $text2 -replace '8PM\s*–\s*5AM', '8PM-5AM'
  $bytes2 = [System.Text.Encoding]::UTF8.GetBytes($text2)

  [System.IO.File]::WriteAllBytes($path, $bytes2)

  if ($text2 -ne $text) {
    Ok "[OK] Patched: $path"
  } else {
    Ok "[OK] No changes needed: $path"
  }
}

Info "NEXT: npm.cmd run build"
