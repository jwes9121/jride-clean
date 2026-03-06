#requires -Version 5.1
<#
PATCH JRIDE WEB: add assign_ok to AssignInfo type in app/ride/page.tsx
V1.1 / PS5-safe / regex-tolerant / ASCII-only
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) { throw $msg }

function EnsureDir($p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

function ReadText($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing file: $path"
  }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function WriteTextUtf8NoBom($path, $content) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

function BackupFile($src, $bakDir, $tag) {
  EnsureDir $bakDir
  if (-not (Test-Path -LiteralPath $src)) {
    throw "Missing file: $src"
  }
  $name = [System.IO.Path]::GetFileName($src)
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $dst = Join-Path $bakDir ($name + ".bak." + $tag + "." + $stamp)
  Copy-Item -LiteralPath $src -Destination $dst -Force
  return $dst
}

Write-Host "== PATCH JRIDE WEB: add assign_ok to AssignInfo type (V1.1 / PS5-safe) ==" -ForegroundColor Cyan

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$target = Join-Path $root "app\ride\page.tsx"
$bakDir = Join-Path $root "_patch_bak"

if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$content = ReadText $target
$bak = BackupFile $target $bakDir "RIDE_ASSIGNINFO_ADD_ASSIGNOK_V1_1"
Write-Host "[OK] Backup: $bak"

$pattern = '(?s)type\s+AssignInfo\s*=\s*\{.*?\n\};'
$matches = [regex]::Matches($content, $pattern)

if ($matches.Count -lt 1) {
  Fail "PATCH FAIL (ASSIGNINFO_BLOCK): type AssignInfo block not found."
}
if ($matches.Count -gt 1) {
  Fail "PATCH FAIL (ASSIGNINFO_BLOCK): multiple AssignInfo blocks found. Refuse to patch."
}

$block = $matches[0].Value

if ($block -match 'assign_ok\?\s*:\s*boolean\s*\|\s*null\s*;') {
  Write-Host "[OK] assign_ok already present in AssignInfo"
} else {
  if ($block -match 'ok\?\s*:\s*boolean\s*\|\s*null\s*;') {
    $newBlock = [regex]::Replace(
      $block,
      'ok\?\s*:\s*boolean\s*\|\s*null\s*;',
      "ok?: boolean | null;`r`n  assign_ok?: boolean | null;",
      1
    )
  } else {
    $newBlock = [regex]::Replace(
      $block,
      '\{',
      "{`r`n  assign_ok?: boolean | null;",
      1
    )
  }

  $content = $content.Replace($block, $newBlock)
  Write-Host "[OK] Added assign_ok to AssignInfo"
}

WriteTextUtf8NoBom $target $content
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "Done."