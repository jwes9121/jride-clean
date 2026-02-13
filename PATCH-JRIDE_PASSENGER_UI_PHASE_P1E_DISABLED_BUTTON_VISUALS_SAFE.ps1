# PATCH-JRIDE_PASSENGER_UI_PHASE_P1E_DISABLED_BUTTON_VISUALS_SAFE.ps1
# PHASE P1E (UI-only): improve disabled button visuals across app/ride/page.tsx
# - No logic changes
# - No JSX insertions
# - Only modifies className strings on native <button ...> tags
# - Adds Tailwind disabled: variants for consistent greyed-out styling

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Read-Utf8NoBom($p){
  if(!(Test-Path $p)){ Fail "Missing file: $p" }
  [System.IO.File]::ReadAllText($p, [System.Text.UTF8Encoding]::new($false))
}
function Write-Utf8NoBom($p,$t){
  [System.IO.File]::WriteAllText($p, $t, [System.Text.UTF8Encoding]::new($false))
}
function Backup($p){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$p.bak.$ts"
  Copy-Item -Force $p $bak
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$targetRel = "app\ride\page.tsx"
$target = Join-Path $root $targetRel
if(!(Test-Path $target)){ Fail "Not found: $targetRel" }

Backup $target
$t = Read-Utf8NoBom $target

# Idempotency marker: if we've already applied disabled variants in this file, skip safely
if($t -match "PHASE P1E DISABLED VISUALS" -or $t -match "disabled:opacity-50"){
  Write-Host "[OK] P1E visuals already present (skip)"
  Write-Utf8NoBom $target $t
  Write-Host "[NEXT] npm.cmd run build"
  exit 0
}

# Tailwind disabled styling we want to append to native button className strings
$addon = " disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"

# Regex: find native <button ... className="..."> occurrences and append addon if not already present
# We only touch <button> tags, not <Button /> components.
$rx = [regex]::new('(<button\b[^>]*\bclassName=")([^"]*)(")', `
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

$changed = 0
$t2 = $rx.Replace($t, {
  param($m)

  $prefix = $m.Groups[1].Value
  $cls    = $m.Groups[2].Value
  $suffix = $m.Groups[3].Value

  # If already has disabled: styling, leave unchanged
  if($cls -match 'disabled:opacity-50' -or $cls -match 'disabled:cursor-not-allowed' -or $cls -match 'disabled:pointer-events-none'){
    return $m.Value
  }

  $changed++
  return $prefix + $cls + $addon + $suffix
})

# Add a simple marker comment at top of file (safe, no JSX)
if($t2 -notmatch "PHASE P1E DISABLED VISUALS"){
  $marker = "/* PHASE P1E DISABLED VISUALS (UI-only): add disabled button styling on native <button> tags */`n"
  $t2 = $marker + $t2
}

Write-Utf8NoBom $target $t2
Write-Host "[OK] Patched: $targetRel"
Write-Host "[OK] Updated native <button> className occurrences: $changed"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
