param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$path, [string]$repoRoot) {
  $bakDir = Join-Path $repoRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($path)
  $bak = Join-Path $bakDir ("{0}.bak.{1}" -f $name, $ts)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  return $bak
}

function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m) { Write-Host $m -ForegroundColor Green }

$appDir = Join-Path $RepoRoot "app"
if (!(Test-Path $appDir)) { Fail "[FAIL] app/ not found. Run from repo root or pass -RepoRoot." }

# Find candidate dashboard files by text anchors (conservative)
$candidates = Get-ChildItem -Path $appDir -Recurse -File -Include *.ts,*.tsx |
  Where-Object {
    $p = $_.FullName
    try {
      $t = Get-Content -LiteralPath $p -Raw -ErrorAction Stop
      ($t -match "session ok" -or $t -match "signed in" -or $t -match "Session ok") -and
      ($t -match "Verification required" -or $t -match "verification required")
    } catch { $false }
  }

if ($candidates.Count -eq 0) {
  Fail "[FAIL] Could not find a Passenger Dashboard file using anchors (session ok + Verification required). Paste the dashboard file path or adjust anchors."
}
if ($candidates.Count -gt 1) {
  Write-Host "[INFO] Multiple candidates found:" -ForegroundColor Yellow
  $candidates | ForEach-Object { Write-Host (" - " + $_.FullName) }
  Fail "[FAIL] Refusing to guess. Narrow this down by searching for the exact dashboard text and re-run."
}

$target = $candidates[0].FullName
Ok ("[OK] Target: {0}" -f $target)

$src = Get-Content -LiteralPath $target -Raw

# Safety: must be a client component to use signOut onClick
if ($src -notmatch '"use client"' -and $src -notmatch "'use client'") {
  Fail "[FAIL] Target is not a client component (missing 'use client'). Refusing to inject signOut."
}

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)

# 1) Ensure import exists
if ($src -notmatch 'from\s+"next-auth/react"' -and $src -notmatch "from\s+'next-auth/react'") {
  # Insert after React import (best-effort, still conservative)
  $src2 = $src -replace "(import\s+React[^`r`n]*[`r`n]+)", "`$1import { signOut } from `"next-auth/react`";`r`n"
  if ($src2 -eq $src) {
    Fail "[FAIL] Could not locate a React import line to safely insert next-auth import."
  }
  $src = $src2
  Ok "[OK] Added: import { signOut } from next-auth/react"
} elseif ($src -notmatch '\bsignOut\b') {
  # next-auth/react import exists but signOut not imported; attempt to add to existing import
  $src2 = $src -replace 'import\s*\{\s*([^}]+)\s*\}\s*from\s*["'']next-auth/react["''];',
    { param($m)
      $inner = $m.Groups[1].Value
      if ($inner -match '\bsignOut\b') { return $m.Value }
      return 'import { ' + ($inner.Trim() + ', signOut') + ' } from "next-auth/react";'
    }
  if ($src2 -eq $src) {
    Fail "[FAIL] next-auth/react import exists but could not safely add signOut."
  }
  $src = $src2
  Ok "[OK] Updated next-auth/react import to include signOut"
} else {
  Ok "[OK] signOut already present"
}

# 2) Inject button near "session ok" anchor line (refuse if not found)
$needle = "session ok"
$idx = $src.ToLower().IndexOf($needle)
if ($idx -lt 0) {
  Fail "[FAIL] Could not find 'session ok' anchor after import injection. Refusing to inject button."
}

# Insert a small button block after the first occurrence of "session ok" line break
# We look for the end of the line containing session ok
$lineEnd = $src.IndexOf("`n", $idx)
if ($lineEnd -lt 0) { $lineEnd = $src.Length }

$button = @"
`r`n{/* JRIDE_SIGNOUT_BUTTON_BEGIN */}
<button
  type="button"
  className="ml-2 rounded border px-3 py-1 text-xs hover:bg-gray-50"
  onClick={() => signOut({ callbackUrl: "/" })}
>
  Sign out
</button>
{/* JRIDE_SIGNOUT_BUTTON_END */}
"@

if ($src -match "JRIDE_SIGNOUT_BUTTON_BEGIN") {
  Ok "[OK] Sign out button block already present"
} else {
  $src = $src.Insert($lineEnd, $button)
  Ok "[OK] Injected Sign out button block"
}

WriteUtf8NoBom $target $src
Ok "[OK] Wrote UTF-8 (no BOM)"
Ok "[DONE] PATCH-JRIDE_PASSENGER_SIGNOUT_V1_PS5SAFE"
