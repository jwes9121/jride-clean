param(
  [string]$RepoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

if (!(Test-Path $RepoRoot)) { Die "RepoRoot not found: $RepoRoot" }

# PS5-safe: build paths explicitly (no Join-Path with an array)
$targets = @(
  ($RepoRoot.TrimEnd("\") + "\app\api\public\passenger\can-book\route.ts"),
  ($RepoRoot.TrimEnd("\") + "\app\ride\page.tsx")
)

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

foreach ($path in $targets) {
  if (!(Test-Path $path)) {
    Warn ("[WARN] Missing (skipping): {0}" -f $path)
    continue
  }

  $rel = $path.Substring($RepoRoot.Length).TrimStart("\")
  $bak = Join-Path $bakDir ((($rel -replace "[\\/:*?""<>|]", "_")) + ".bak." + $stamp)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok ("[OK] Backup: {0}" -f $bak)

  $c = Get-Content -LiteralPath $path -Raw
  $orig = $c

  # Allowed VERIFIED statuses per DB constraint:
  # - approved_admin
  # - pre_approved_dispatcher

  # 1) Replace common patterns: status === 'approved' / "approved"
  $c = $c -replace "status\s*===\s*'approved'", "(status === 'approved_admin' -or status === 'pre_approved_dispatcher')"
  $c = $c -replace 'status\s*===\s*"approved"', '(status === "approved_admin" -or status === "pre_approved_dispatcher")'

  # 2) Replace startsWith("approved") checks if present
  $c = $c -replace 'status\?\.\s*startsWith\(\s*"approved"\s*\)', '(status === "approved_admin" -or status === "pre_approved_dispatcher")'
  $c = $c -replace "status\?\.\s*startsWith\(\s*'approved'\s*\)", "(status === 'approved_admin' -or status === 'pre_approved_dispatcher')"

  # 3) Replace simple assigned boolean like: const verified = status === 'approved'
  $c = $c -replace "(\bverified\b\s*=\s*)\(?(status\s*===\s*'approved')\)?", '${1}(status === ''approved_admin'' -or status === ''pre_approved_dispatcher'')'
  $c = $c -replace '(\bverified\b\s*=\s*)\(?(status\s*===\s*"approved")\)?', '${1}(status === "approved_admin" -or status === "pre_approved_dispatcher")'

  if ($c -ne $orig) {
    Set-Content -LiteralPath $path -Value $c -Encoding UTF8
    Ok ("[OK] Patched: {0}" -f $rel)
  } else {
    Warn ("[WARN] No matching 'approved' checks found in: {0} (logic may use different variable names)" -f $rel)
  }
}

Ok "[OK] DONE. Next: npm.cmd run build"
