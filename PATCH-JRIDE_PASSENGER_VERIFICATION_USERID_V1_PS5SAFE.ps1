param(
  [string]$RepoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

if (!(Test-Path $RepoRoot)) { Die "RepoRoot not found: $RepoRoot" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

# targets: any ts/tsx/sql files under app that contain passenger_user_id
$targets = Get-ChildItem -Path (Join-Path $RepoRoot "app") -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in ".ts",".tsx",".sql" } |
  Where-Object {
    $c = Get-Content -LiteralPath $_.FullName -Raw
    $c -match "passenger_user_id"
  }

if (!$targets -or $targets.Count -eq 0) {
  Warn "[WARN] No files found containing 'passenger_user_id'. Nothing to patch."
  exit 0
}

Ok ("[OK] Found {0} file(s) containing passenger_user_id" -f $targets.Count)

foreach ($f in $targets) {
  $path = $f.FullName
  $rel  = $path.Substring($RepoRoot.Length).TrimStart("\")
  $bak  = Join-Path $bakDir ((($rel -replace "[\\/:*?""<>|]", "_") ) + ".bak." + $stamp)

  Copy-Item -LiteralPath $path -Destination $bak -Force
  $content = Get-Content -LiteralPath $path -Raw

  # Replace identifier usage
  $content2 = $content -replace "\bpassenger_user_id\b", "user_id"

  # Also fix common JSON key usage in strings (e.g., "passenger_user_id":)
  $content2 = $content2 -replace "passenger_user_id\s*:", "user_id:"

  if ($content2 -ne $content) {
    Set-Content -LiteralPath $path -Value $content2 -Encoding UTF8
    Ok ("[OK] Patched: {0}" -f $rel)
    Ok ("     Backup: {0}" -f $bak)
  } else {
    Warn ("[WARN] No changes after replace in: {0}" -f $rel)
  }
}

Ok "[OK] DONE. Next: run a quick search to confirm zero 'passenger_user_id' left."
Ok ("      Get-ChildItem -Path `"$RepoRoot\app`" -Recurse -File | Select-String -Pattern `"\bpassenger_user_id\b`"")
