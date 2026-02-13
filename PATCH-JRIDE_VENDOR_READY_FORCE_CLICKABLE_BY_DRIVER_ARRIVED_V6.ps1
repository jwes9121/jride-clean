$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = Get-Location
$path = Join-Path $root 'app\vendor-orders\page.tsx'
if (!(Test-Path $path)) { Fail "Missing app\vendor-orders\page.tsx (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $(Split-Path $bak -Leaf)"

$txt = Get-Content -LiteralPath $path -Raw

$needle = 'driver_arrived'
$pos = $txt.IndexOf($needle)
if ($pos -lt 0) {
  Fail "Could not find '$needle' in vendor-orders/page.tsx. The ready action may use a different status string."
}

# Find nearest preceding <button
$btnStart = $txt.LastIndexOf('<button', $pos)
if ($btnStart -lt 0) { Fail "Could not find a <button> tag before the first '$needle' occurrence." }

# Find end of opening tag '>'
$btnOpenEnd = $txt.IndexOf('>', $btnStart)
if ($btnOpenEnd -lt 0) { Fail "Malformed <button ...> tag: could not find closing '>'." }

$openTag = $txt.Substring($btnStart, $btnOpenEnd - $btnStart + 1)

# If the needle is not within the opening tag, try to locate a closer button whose opening tag contains the needle
if ($openTag -notmatch $needle) {
  # scan forward from btnStart to pos for a <button ... driver_arrived ...>
  $window = $txt.Substring($btnStart, [Math]::Min($txt.Length - $btnStart, ($pos - $btnStart + 200)))
  $m = [regex]::Match($window, '(?s)<button[^>]*driver_arrived[^>]*>')
  if ($m.Success) {
    $openTag = $m.Value
    $btnStart = $btnStart + $m.Index
    $btnOpenEnd = $btnStart + $m.Length - 1
  }
}

# Patch the opening tag (no mojibake literals, purely ASCII ops)
$patched = $openTag

# remove disabled={...}
$patched = [regex]::Replace($patched, '\sdisabled=\{[^}]*\}', '', 1)

# remove pointer-events-none / cursor-not-allowed / opacity-*
$patched = [regex]::Replace($patched, 'pointer-events-none', '')
$patched = [regex]::Replace($patched, 'cursor-not-allowed', '')
$patched = [regex]::Replace($patched, '\bopacity-\d+\b', '')

# ensure className has pointer-events-auto cursor-pointer
if ($patched -match 'className=\{"([^"]*)"\}') {
  $patched = [regex]::Replace(
    $patched,
    'className=\{"([^"]*)"\}',
    {
      param($mm)
      $cls = $mm.Groups[1].Value
      if ($cls -notmatch 'pointer-events-auto') { $cls = ($cls.Trim() + ' pointer-events-auto') }
      if ($cls -notmatch 'cursor-pointer') { $cls = ($cls.Trim() + ' cursor-pointer') }
      $cls = [regex]::Replace($cls, '\s{2,}', ' ').Trim()
      'className={"' + $cls + '"}'
    },
    1
  )
} else {
  # no className: add one
  $patched = $patched -replace '<button', '<button className={"pointer-events-auto cursor-pointer"}'
}

$patched = [regex]::Replace($patched, '\s{2,}', ' ')

# Write back
$txt2 = $txt.Substring(0, $btnStart) + $patched + $txt.Substring($btnOpenEnd + 1)

# UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $txt2, $utf8)

Ok "[OK] Ready button unblocked by locating nearest <button> before 'driver_arrived' and forcing pointer-events."
Info "NEXT: npm run build"
