# PATCH-JRIDE_RIDE_MAP_PICKMODE_REF_FIX_V1B.ps1
# Fix: Map click uses stale pickMode closure; dropoff mode still moves pickup.
# Target: app\ride\page.tsx

$ErrorActionPreference = "Stop"

$ROOT = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$FILE = Join-Path $ROOT "app\ride\page.tsx"
if (!(Test-Path $FILE)) { throw "Missing file: $FILE" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FILE.bak.$ts"
Copy-Item $FILE $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $FILE -Raw

if ($txt -match "JRIDE_PICKMODE_REF_FIX_V1B_APPLIED") {
  Write-Host "[SKIP] Already applied."
  exit 0
}

# 1) Insert pickModeRef + sync effect right after pickMode state declaration (supports generics)
if ($txt -notmatch "pickModeRef\.current") {

  $m = [regex]::Match(
    $txt,
    '(?m)^\s*const\s*\[\s*pickMode\s*,\s*setPickMode\s*\]\s*=\s*(?:React\.)?useState(?:<[^>]+>)?\([^;]*\);\s*$'
  )

  if (!$m.Success) {
    throw "Could not find pickMode state line. Expected: const [pickMode, setPickMode] = useState<...>(...);"
  }

  $insertAfter = $m.Index + $m.Length

  $ins = @'

  // JRIDE_PICKMODE_REF_FIX_V1B: keep latest pickMode for Mapbox click handler (prevents stale closure)
  const pickModeRef = React.useRef<"pickup" | "dropoff">(pickMode);
  React.useEffect(() => { pickModeRef.current = pickMode; }, [pickMode]);

'@

  $txt = $txt.Substring(0, $insertAfter) + $ins + $txt.Substring($insertAfter)
  Write-Host "[OK] Inserted pickModeRef + sync effect."
} else {
  Write-Host "[SKIP] pickModeRef already present."
}

# 2) Patch the Mapbox click handler to use pickModeRef.current (your file uses mapRef.current.on("click"...))
# Replace only inside the first click handler block to avoid touching other logic.
$click = [regex]::Match($txt, '(?s)(mapRef\.current\.on\(\s*["'']click["'']\s*,\s*async\s*\([^)]*\)\s*=>\s*\{)(.*?)(\}\s*\)\s*;)')
if (!$click.Success) {
  throw "Could not find mapRef.current.on('click', async (...) => { ... }); block."
}

$head = $click.Groups[1].Value
$body = $click.Groups[2].Value
$tail = $click.Groups[3].Value

if ($body -notmatch 'pickModeRef\.current') {

  # Patch common patterns inside the handler
  $body2 = $body

  # Most important: if (pickMode === "pickup") ...
  $body2 = $body2 -replace '\bpickMode\b\s*===\s*"pickup"', 'pickModeRef.current === "pickup"'
  $body2 = $body2 -replace '\bpickMode\b\s*===\s*"dropoff"', 'pickModeRef.current === "dropoff"'

  # If there are any remaining raw "pickMode" references in this handler, replace the first one
  if ($body2 -match '\bpickMode\b') {
    $body2 = [regex]::Replace($body2, '\bpickMode\b', 'pickModeRef.current', 1)
  }

  if ($body2 -eq $body) {
    throw "Click handler patch did not change anything (no pickMode usage detected)."
  }

  $txt = $txt.Substring(0, $click.Index) + $head + $body2 + $tail + $txt.Substring($click.Index + $click.Length)
  Write-Host "[OK] Patched click handler to use pickModeRef.current."
} else {
  Write-Host "[SKIP] Click handler already uses pickModeRef.current."
}

# Mark applied + write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$txt = $txt + "`r`n/* JRIDE_PICKMODE_REF_FIX_V1B_APPLIED */`r`n"
[System.IO.File]::WriteAllText($FILE, $txt, $utf8NoBom)

Write-Host "[OK] Patched: $FILE"
Write-Host ""
Write-Host "[NEXT] Build:"
Write-Host "  Set-Location `"$ROOT`""
Write-Host "  npm.cmd run build"
