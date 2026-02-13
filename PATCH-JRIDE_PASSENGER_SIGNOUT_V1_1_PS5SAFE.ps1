param(
  [Parameter(Mandatory=$true)]
  [string]$TargetFile
)

$ErrorActionPreference = "Stop"

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$path) {
  $repoRoot = (Get-Location).Path
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

if (!(Test-Path -LiteralPath $TargetFile)) {
  Fail ("[FAIL] TargetFile not found: {0}" -f $TargetFile)
}

$src = Get-Content -LiteralPath $TargetFile -Raw

# Must be client component for next-auth/react signOut
if ($src -notmatch '"use client"' -and $src -notmatch "'use client'") {
  Fail "[FAIL] Missing 'use client' in target file. Refusing to inject signOut into a server component."
}

$bak = BackupFile $TargetFile
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $TargetFile)

# Ensure import { signOut } from "next-auth/react";
if ($src -notmatch 'from\s+["'']next-auth/react["'']') {
  # Insert after first import line
  $m = [regex]::Match($src, "^(import[^\r\n]*\r?\n)", "Multiline")
  if (!$m.Success) { Fail "[FAIL] Could not find an import line to anchor insertion." }

  $insert = $m.Value + "import { signOut } from `"next-auth/react`";`r`n"
  $src = $src.Substring(0, $m.Index) + $insert + $src.Substring($m.Index + $m.Length)
  Ok "[OK] Added next-auth/react import (signOut)"
}
elseif ($src -notmatch '\bsignOut\b') {
  # Add signOut to existing named import from next-auth/react if possible
  $src2 = [regex]::Replace(
    $src,
    'import\s*\{\s*([^}]+)\s*\}\s*from\s*["'']next-auth/react["''];',
    {
      param($m)
      $inner = $m.Groups[1].Value
      if ($inner -match '\bsignOut\b') { return $m.Value }
      return 'import { ' + ($inner.Trim() + ', signOut') + ' } from "next-auth/react";'
    },
    1
  )
  if ($src2 -eq $src) { Fail "[FAIL] Found next-auth/react import but could not safely add signOut." }
  $src = $src2
  Ok "[OK] Updated next-auth/react import to include signOut"
}
else {
  Ok "[OK] signOut already imported"
}

# Inject button near an anchor that must exist
$anchors = @("session ok","signed in","Session ok","Verification required")
$foundAnchor = $null
foreach ($a in $anchors) {
  if ($src.ToLower().Contains($a.ToLower())) { $foundAnchor = $a; break }
}
if (-not $foundAnchor) {
  Fail "[FAIL] Could not find any safe anchor text (session ok / signed in / verification required). Refusing to inject button."
}

$idx = $src.ToLower().IndexOf($foundAnchor.ToLower())
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
  Ok "[OK] Sign out block already present"
} else {
  $src = $src.Insert($lineEnd, $button)
  Ok ("[OK] Injected Sign out button after anchor: {0}" -f $foundAnchor)
}

WriteUtf8NoBom $TargetFile $src
Ok "[OK] Wrote UTF-8 (no BOM)"
Ok "[DONE] PATCH-JRIDE_PASSENGER_SIGNOUT_V1_1_PS5SAFE"
