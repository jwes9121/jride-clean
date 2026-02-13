# PATCH-JRIDE_PHASE11D4_BACKEND_NIGHTGATE_DEBUG_BYPASS_FIX.ps1
# Adds safe debug bypass for NIGHT_GATE_UNVERIFIED in passenger public routes.
# Bypass only when ALLOW_DEBUG_BYPASS=1 AND (body.debug true/"1" OR query ?debug=1)
# ASCII only. PowerShell 5 compatible.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Join-Path (Get-Location) "app\api\public\passenger"
if (-not (Test-Path $root)) { Fail "Not found: $root" }

Info "Scanning for route.ts containing NIGHT_GATE_UNVERIFIED under: $root"

$files = Get-ChildItem -Path $root -Recurse -File -Filter "route.ts" -ErrorAction SilentlyContinue
if (-not $files -or $files.Count -eq 0) { Fail "No route.ts files found under $root" }

$targets = @()
foreach ($f in $files) {
  $t = $null
  try { $t = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 } catch { continue }
  if ($null -eq $t) { continue }
  if ($t -match 'NIGHT_GATE_UNVERIFIED') { $targets += $f }
}

if ($targets.Count -eq 0) {
  Fail "No passenger public route.ts contains NIGHT_GATE_UNVERIFIED. Paste the path of the route throwing BOOK_FAILED."
}

Info ("Targets found: " + $targets.Count)
$targets | ForEach-Object { Write-Host (" - " + $_.FullName) }

foreach ($f in $targets) {
  $path = $f.FullName
  Info "Patching: $path"

  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$stamp"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok "Backup: $bak"

  $txt = Get-Content -LiteralPath $path -Raw -Encoding UTF8

  # If already patched, skip
  if ($txt -match 'ALLOW_DEBUG_BYPASS') {
    Info "Already contains ALLOW_DEBUG_BYPASS. Skipping insert of debugBypass var."
  } else {
    $didInsert = $false

    # Preferred POST anchor: body parse with catch
    $p1 = 'const body = await req.json().catch(() => ({}));'
    if ($txt.IndexOf($p1) -ge 0) {
      $ins = $p1 + @"

    const debugBypass =
      process.env.ALLOW_DEBUG_BYPASS === "1" &&
      ((body && (body.debug === true || body.debug === "1")) ||
        new URL(req.url).searchParams.get("debug") === "1");
"@
      $txt = $txt.Replace($p1, $ins)
      $didInsert = $true
    }

    # Alternate POST anchor: simple body parse
    if (-not $didInsert) {
      $p2 = 'const body = await req.json();'
      if ($txt.IndexOf($p2) -ge 0) {
        $ins2 = $p2 + @"

    const debugBypass =
      process.env.ALLOW_DEBUG_BYPASS === "1" &&
      ((body && (body.debug === true || body.debug === "1")) ||
        new URL(req.url).searchParams.get("debug") === "1");
"@
        $txt = $txt.Replace($p2, $ins2)
        $didInsert = $true
      }
    }

    # GET-only fallback: after url parse
    if (-not $didInsert) {
      $pG = 'const url = new URL(req.url);'
      if ($txt.IndexOf($pG) -ge 0) {
        $insG = $pG + @"

    const debugBypass =
      process.env.ALLOW_DEBUG_BYPASS === "1" &&
      (url.searchParams.get("debug") === "1");
"@
        $txt = $txt.Replace($pG, $insG)
        $didInsert = $true
      }
    }

    if (-not $didInsert) {
      Fail "Could not locate a body/url parse anchor in: $path. Paste first 140 lines of that file."
    }
  }

  # Wrap returns that include NIGHT_GATE_UNVERIFIED
  $lines = $txt -split "`r?`n"
  $out = New-Object System.Collections.Generic.List[string]
  $wrapped = 0

  for ($i=0; $i -lt $lines.Length; $i++) {
    $ln = $lines[$i]

    if (($ln -match 'NIGHT_GATE_UNVERIFIED') -and ($ln -match '^\s*return\s+')) {
      $out.Add('      if (typeof debugBypass !== "undefined" -and debugBypass) { /* debug bypass */ } else { ' + $ln.Trim() + ' }') | Out-Null
      $wrapped++
    } else {
      $out.Add($ln) | Out-Null
    }
  }

  if ($wrapped -gt 0) {
    Ok ("Wrapped NIGHT_GATE_UNVERIFIED return lines: " + $wrapped)
  } else {
    Info "No single-line return containing NIGHT_GATE_UNVERIFIED found to wrap (may be multi-line)."
    Info "If booking still blocks after this patch, we will patch the specific block manually by file upload."
  }

  $newTxt = ($out.ToArray() -join "`r`n")

  # ASCII safety
  $newTxt = $newTxt.Replace([char]0x2013, "-").Replace([char]0x2014, "-")
  $newTxt = $newTxt.Replace([char]0x2018, "'").Replace([char]0x2019, "'")
  $newTxt = $newTxt.Replace([char]0x201C, '"').Replace([char]0x201D, '"')

  Set-Content -LiteralPath $path -Value $newTxt -Encoding UTF8
  Ok "Patched: $path"
}

Ok "All targets processed."
Ok "Done."
