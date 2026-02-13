$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

if (!(Test-Path ".\package.json")) { Fail "Run from repo root (package.json missing)." }
if (!(Test-Path ".\app")) { Fail "Expected ./app folder." }

$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")

# Targets: passenger landing + auth pages if present (no assumptions, patch if found)
$targets = @(
  ".\app\passenger\page.tsx",
  ".\app\passenger-login\page.tsx",
  ".\app\passenger-signup\page.tsx"
) | Where-Object { Test-Path $_ }

if ($targets.Count -eq 0) { Fail "No target files found (passenger/passenger-login/passenger-signup page.tsx)." }

function ReadText($p){ [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }
function WriteText($p,$t){ [IO.File]::WriteAllText($p, $t, [Text.Encoding]::UTF8) }

# Replace common mojibake safely with ASCII.
function FixMojibake([string]$s){
  $r = $s

  # Most common offenders
  $r = $r.Replace("-", "-")     # en dash
  $r = $r.Replace("-", "-")     # em dash
  $r = $r.Replace("'", "'")
  $r = $r.Replace("'", "'")
  $r = $r.Replace(""", """")
  $r = $r.Replace("â€ ", """")
  $r = $r.Replace("â€¦", "...")

  # Sometimes seen variants
  $r = $r.Replace("Ã¢â‚¬"", "-")
  $r = $r.Replace("Ã¢â‚¬â€ ", "-")
  $r = $r.Replace("Ã¢â‚¬â„¢", "'")
  $r = $r.Replace("Ã¢â‚¬Å“", """")
  $r = $r.Replace("Ã¢â‚¬", """")

  # Force the exact window we care about to ASCII
  $r = $r.Replace("(8PM–5AM)", "(8PM-5AM)")
  $r = $r.Replace("(8PM-5AM)", "(8PM-5AM)")

  return $r
}

foreach($path in $targets){
  Copy-Item $path "$path.bak.$ts" -Force
  Ok "[OK] Backup: $path.bak.$ts"

  $txt = ReadText $path
  $txt2 = FixMojibake $txt

  if ($txt2 -ne $txt) {
    WriteText $path $txt2
    Ok "[OK] Patched mojibake -> ASCII: $path"
  } else {
    Ok "[OK] No mojibake found: $path"
  }
}

Info "NEXT: npm.cmd run build"
