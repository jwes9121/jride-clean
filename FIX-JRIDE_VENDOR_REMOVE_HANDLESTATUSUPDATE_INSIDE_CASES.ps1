# FIX-JRIDE_VENDOR_REMOVE_HANDLESTATUSUPDATE_INSIDE_CASES.ps1
# Remove any "async function handleStatusUpdate" declared inside switch/case blocks.
# Keeps the properly-scoped handler (outside case blocks).
# File: app/vendor-orders/page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\vendor-orders\page.tsx"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "File not found: $path (run from repo root)" }

$bak = "$path.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "Backup: $bak"

$lines = Get-Content -LiteralPath $path -ErrorAction Stop

# We remove any block that starts with: async function handleStatusUpdate(...)
# ONLY when we are currently inside a "case ...:" region of a switch.
# We detect being inside a case by seeing "case "..." :" and staying in that mode until next "case"/"default"/end switch brace.
# For function removal, we remove from the function line through the matching closing brace of that function.

$inCase = $false
$removedCount = 0
$out = New-Object System.Collections.Generic.List[string]

for ($i = 0; $i -lt $lines.Count; $i++) {
  $line = $lines[$i]

  # Detect entering a case/default label
  if ($line -match '^\s*case\s+"[^"]+"\s*:\s*$' -or $line -match "^\s*case\s+'[^']+'\s*:\s*$" -or $line -match '^\s*default\s*:\s*$') {
    $inCase = $true
    $out.Add($line)
    continue
  }

  # Detect leaving case region crudely when we hit another switch label is handled above,
  # or when we see a closing brace at column 0-ish (end of switch). This is heuristic but safe enough.
  if ($inCase -and $line -match '^\s*\}\s*$') {
    $inCase = $false
    $out.Add($line)
    continue
  }

  # If inside case and we see a case-scoped handleStatusUpdate, remove it
  if ($inCase -and $line -match '^\s*async\s+function\s+handleStatusUpdate\s*\(') {
    $removedCount++

    # Now skip until we close this function body by counting braces starting at the first "{"
    $braceDepth = 0
    $seenOpen = $false

    # Consume current line and subsequent lines
    for (; $i -lt $lines.Count; $i++) {
      $l = $lines[$i]

      # Count braces (simple)
      foreach ($ch in $l.ToCharArray()) {
        if ($ch -eq '{') { $braceDepth++; $seenOpen = $true }
        elseif ($ch -eq '}') { $braceDepth-- }
      }

      if ($seenOpen -and $braceDepth -le 0) {
        break # function ended; outer loop will i++ and continue
      }
    }

    continue
  }

  $out.Add($line)
}

if ($removedCount -eq 0) {
  Fail "No case-scoped handleStatusUpdate() found to remove. Paste lines 90-130 of app/vendor-orders/page.tsx."
}

Set-Content -LiteralPath $path -Value $out -Encoding UTF8
Ok "Patched: $rel"
Ok "Removed case-scoped handleStatusUpdate blocks: $removedCount"
