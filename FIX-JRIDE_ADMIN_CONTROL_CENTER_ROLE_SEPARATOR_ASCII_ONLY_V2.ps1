# FIX-JRIDE_ADMIN_CONTROL_CENTER_ROLE_SEPARATOR_ASCII_ONLY_V2.ps1
# ASCII-only. UTF8 NO BOM. Removes non-ASCII separator in the "Role:" display.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Timestamp(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadText($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [System.IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object System.Text.UTF8Encoding($false); [System.IO.File]::WriteAllText($p,$t,$enc) }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\control-center\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

$bak = "$target.bak.$(Timestamp)"
Copy-Item -Force $target $bak
Write-Host "[OK] Backup: $bak"

$txt = ReadText $target
$orig = $txt

# Replace any non-ASCII char inside the role pill interpolation with " - "
# Typical pattern in TSX:
#   Role: {role} {roleSource ? ` · ${roleSource}` : ""}
# We replace any non-ASCII char that appears between backticks in that template.
$rx = [regex]::new('(\?\s*`[^`]*)([^ -~])([^`]*`\s*:\s*""\s*\})', 'Singleline')

$changed = $false
$txt2 = $rx.Replace($txt, {
  param($m)
  $script:changed = $true
  return $m.Groups[1].Value + " - " + $m.Groups[3].Value
})

# Fallback: if template shape differs, do a broader safe cleanup:
# replace any non-ASCII character in the entire file with a normal dot only for this specific known line label.
if(-not $changed){
  $rx2 = [regex]::new('Role:\s*\{[^}]+\}[^`]*`[^`]*`', 'Singleline')
  $m2 = $rx2.Match($txt)
  if($m2.Success){
    $seg = $m2.Value
    # Replace any non-ASCII char in that segment with " - "
    $seg2 = [regex]::Replace($seg, '[^ -~]+', ' - ')
    $txt2 = $txt.Replace($seg, $seg2)
    $changed = ($txt2 -ne $txt)
  }
}

if(-not $changed){
  Fail "ANCHOR NOT FOUND: Could not locate the Role display template to sanitize."
}

WriteUtf8NoBom $target $txt2
Write-Host "[OK] Sanitized Role separator to ASCII ' - '"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
