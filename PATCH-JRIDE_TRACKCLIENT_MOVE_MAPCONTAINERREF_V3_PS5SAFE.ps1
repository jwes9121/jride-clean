# PATCH-JRIDE_TRACKCLIENT_MOVE_MAPCONTAINERREF_V3_PS5SAFE.ps1
# Fix: mapContainerRef useRef hook was inserted into a non-component function (e.g., smartNavLabel).
# Action: remove existing mapContainerRef line anywhere, then insert it into the React component body
# right before the first hook call (useState/useEffect/useMemo/useCallback/useRef).
# PS5-safe, backups included.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$projRoot = (Get-Location).Path
$target   = Join-Path $projRoot "app\ride\track\TrackClient.tsx"

Info "== JRide Patch: Move mapContainerRef hook into component body (V3 / PS5-safe) =="
Info ("Target: " + $target)

if (!(Test-Path $target)) { throw "Target not found: $target" }

$bakDir = Join-Path $projRoot "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("TrackClient.tsx.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$raw = Get-Content -Raw -LiteralPath $target

if (!($raw -match 'ref=\{mapContainerRef\}')) {
  Warn "[WARN] ref={mapContainerRef} not found. Nothing to do."
  exit 0
}

# Ensure useRef import exists (already added previously, but keep safe)
if (!($raw -match '(?m)\buseRef\b')) {
  Warn "[WARN] useRef not found anywhere in file; unexpected. Continuing."
}

$lines = $raw -split "`r`n", -1

# 1) Remove any existing mapContainerRef definition line(s)
$removed = 0
$filtered = New-Object System.Collections.Generic.List[string]

foreach ($ln in $lines) {
  if ($ln -match '^\s*const\s+mapContainerRef\s*=\s*useRef<') {
    $removed++
    continue
  }
  $filtered.Add($ln)
}

if ($removed -gt 0) {
  Ok ("[OK] Removed existing mapContainerRef definitions: " + $removed)
} else {
  Warn "[WARN] No existing mapContainerRef definition found to remove (we will insert a fresh one anyway)."
}

# 2) Find insertion point: first hook call inside the main component body
# We look for the first occurrence of any hook call that is typically inside a component.
$hookIdx = -1
for ($i=0; $i -lt $filtered.Count; $i++) {
  if ($filtered[$i] -match '\buse(State|Effect|Memo|Callback|Ref|Reducer|LayoutEffect)\s*\(') {
    $hookIdx = $i
    break
  }
}

if ($hookIdx -lt 0) {
  throw "Could not find a hook call (useState/useEffect/...) to anchor insertion point. Paste the top ~80 lines of TrackClient.tsx if this happens."
}

# Determine indentation from the hook line
$indent = ""
if ($filtered[$hookIdx] -match '^(\s*)') { $indent = $Matches[1] }

$insertion = ($indent + "const mapContainerRef = useRef<HTMLDivElement | null>(null);")

# 3) Insert the ref line right before the first hook call
$out = New-Object System.Collections.Generic.List[string]
for ($i=0; $i -lt $filtered.Count; $i++) {
  if ($i -eq $hookIdx) {
    $out.Add($insertion)
    $out.Add("")  # blank line for readability
  }
  $out.Add($filtered[$i])
}

Set-Content -LiteralPath $target -Value ($out -join "`r`n") -Encoding UTF8
Ok "[OK] Inserted mapContainerRef into component body (before first hook call)."
Ok "[OK] Patched: $target"

Info "Next: npm.cmd run build"
