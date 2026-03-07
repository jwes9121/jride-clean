#requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) { throw $msg }

function EnsureDir($p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
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
  $name = [System.IO.Path]::GetFileName($src)
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $dst = Join-Path $bakDir ($name + ".bak." + $tag + "." + $stamp)
  Copy-Item -LiteralPath $src -Destination $dst -Force
  return $dst
}

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
$target = Join-Path $root "app\ride\page.tsx"
$bakDir = Join-Path $root "_patch_bak"

if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$bak = BackupFile $target $bakDir "RIDE_ASSIGNINFO_NOTIFY_FIELDS_V1"
Write-Host "[OK] Backup: $bak"

$content = ReadText $target

$pattern = '(?s)type\s+AssignInfo\s*=\s*\{.*?\n\};'
$m = [regex]::Match($content, $pattern)

if (-not $m.Success) {
  Fail "PATCH FAIL (ASSIGNINFO_BLOCK): type AssignInfo block not found."
}

$block = $m.Value

$fieldsToAdd = @(
  'notify_ok?: boolean | null;',
  'notify_duplicate?: boolean | null;',
  'notify_error?: string | null;',
  'adopted_existing_assignment?: boolean | null;',
  'backfill_applied?: boolean | null;',
  'code?: string | null;',
  'message?: string | null;'
)

foreach ($f in $fieldsToAdd) {
  if ($block -notmatch [regex]::Escape($f)) {
    $block = $block -replace '\n\};$', "`r`n  $f`r`n};"
  }
}

$content = $content.Substring(0, $m.Index) + $block + $content.Substring($m.Index + $m.Length)

WriteTextUtf8NoBom $target $content
Write-Host "[OK] Patched: $target"