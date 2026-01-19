# FIX-JRIDE_DRIVER_P6_DUPLICATE_DISABLED_PROPS.ps1
# Fix react/jsx-no-duplicate-props in app/driver/page.tsx by deduping disabled={...} props on <button> tags.
# UTF-8 no BOM, ASCII-only, fail-fast.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function WriteUtf8NoBom($path, $content){
  $dir = Split-Path -Parent $path
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($content))
}

$root = (Get-Location).Path
$target = Join-Path $root "app\driver\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw -Encoding utf8
$orig = $txt

# Regex to find opening <button ...> tag (not spanning multiple tags)
$tagRe = New-Object System.Text.RegularExpressions.Regex("<button\b[^>]*>", [System.Text.RegularExpressions.RegexOptions]::Singleline)

$matches = $tagRe.Matches($txt)
if ($matches.Count -eq 0) { Fail "No <button> tags found in file (unexpected)." }

$changes = 0
# Work on a StringBuilder-like approach by rebuilding from end to start
for ($i = $matches.Count - 1; $i -ge 0; $i--) {
  $m = $matches[$i]
  $tag = $m.Value

  # Find disabled={...} occurrences inside this tag
  $disRe = New-Object System.Text.RegularExpressions.Regex("disabled=\{[^}]*\}", [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $dis = $disRe.Matches($tag)

  if ($dis.Count -le 1) { continue }

  # Collect expressions without the wrapper
  $exprs = @()
  foreach ($d in $dis) {
    $raw = $d.Value  # disabled={...}
    $inner = $raw.Substring("disabled={".Length)
    $inner = $inner.Substring(0, $inner.Length - 1) # remove trailing }
    $exprs += $inner.Trim()
  }

  # Determine if paxSaving is present
  $hasPax = $false
  foreach ($e in $exprs) {
    if ($e -match "\bpaxSaving\b") { $hasPax = $true; break }
  }

  # Choose the primary non-pax expression (first one that isn't just paxSaving or doesn't contain paxSaving)
  $primary = $null
  foreach ($e in $exprs) {
    # treat exact paxSaving or containing paxSaving as pax expression
    if ($e -notmatch "\bpaxSaving\b") { $primary = $e; break }
  }

  # Build merged disabled expression
  if ($hasPax -and $primary) {
    # merge: (primary) || paxSaving
    $merged = "disabled={(($primary) || paxSaving)}"
  } elseif ($hasPax -and -not $primary) {
    # only paxSaving duplicates
    $merged = "disabled={paxSaving}"
  } else {
    # no paxSaving involved; keep the first expression only
    $merged = "disabled={($($exprs[0]))}"
  }

  # Rebuild the tag:
  # 1) Replace the FIRST disabled={...} with $merged
  # 2) Remove ALL subsequent disabled={...} occurrences
  $newTag = $tag

  # Replace first occurrence
  $firstOld = $dis[0].Value
  $newTag = $newTag.Replace($firstOld, $merged)

  # Remove remaining occurrences (from last to 2nd)
  for ($k = $dis.Count - 1; $k -ge 1; $k--) {
    $old = $dis[$k].Value
    # Remove with leading whitespace if present to avoid double spaces
    $newTag = [System.Text.RegularExpressions.Regex]::Replace(
      $newTag,
      "\s*" + [System.Text.RegularExpressions.Regex]::Escape($old),
      "",
      1
    )
  }

  if ($newTag -ne $tag) {
    $txt = $txt.Substring(0, $m.Index) + $newTag + $txt.Substring($m.Index + $m.Length)
    $changes++
  }
}

if ($changes -eq 0) { Fail "No duplicate disabled props were found to fix (unexpected given your build error)." }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Fixed duplicate disabled props on $changes <button> tag(s): $target"

Write-Host ""
Write-Host "Now run:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Suggested commit/tag:"
Write-Host "  fix(driver): dedupe duplicate disabled props (P6)"
Write-Host "  JRIDE_DRIVER_P6_DEDUPE_DISABLED_GREEN"
