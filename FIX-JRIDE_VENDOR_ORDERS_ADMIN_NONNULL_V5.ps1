$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = Get-Location
$path = Join-Path $root 'app\api\vendor-orders\route.ts'
if (!(Test-Path $path)) { Fail "Missing: app\api\vendor-orders\route.ts (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$ts"
Copy-Item -LiteralPath $path -Destination $bak -Force
Ok "[OK] Backup: $(Split-Path $bak -Leaf)"

$txt = Get-Content -LiteralPath $path -Raw

# Target ONLY the helper line: await admin.from("bookings")...
# Replace first occurrence of "await admin.from("bookings")" after insertBookingSchemaSafe is introduced.
$pattern = '(?s)(insertBookingSchemaSafe[\s\S]*?)(await\s+)admin\.from\("bookings"\)'
if ($txt -notmatch $pattern) {
  Fail "Could not locate insertBookingSchemaSafe admin.from(""bookings"") call."
}

$new = [regex]::Replace($txt, $pattern, '$1$2admin!.from("bookings")', 1)

if ($new -eq $txt) { Fail "Replacement did not apply (no changes made)." }

# Write UTF-8 no BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $new, $utf8)

Ok "[OK] Patched: admin!.from(""bookings"") inside schema-safe insert helper (TS null check resolved)."
Info "NEXT: npm run build"
