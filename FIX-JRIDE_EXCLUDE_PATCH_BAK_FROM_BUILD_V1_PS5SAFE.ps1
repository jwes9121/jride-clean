param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

function NowStamp(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function Ensure-Dir([string]$p){ if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }

function Write-Utf8NoBom([string]$path, [string]$text){
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

function Backup-File([string]$src, [string]$bakDir, [string]$tag){
  Ensure-Dir $bakDir
  $name = Split-Path -Leaf $src
  $bak = Join-Path $bakDir ($name + ".bak." + $tag + "." + (NowStamp))
  Copy-Item -LiteralPath $src -Destination $bak -Force
  Ok ("Backup: " + $bak)
}

function Ensure-EslintIgnore([string]$path){
  $need = @(
    "_patch_bak/",
    "**/_patch_bak/**",
    ".next/",
    "node_modules/"
  )

  $existing = ""
  if (Test-Path -LiteralPath $path) {
    $existing = [System.IO.File]::ReadAllText($path)
  }

  $lines = @()
  if ($existing) {
    $existing = $existing -replace "`r`n","`n" -replace "`r","`n"
    $lines = $existing.Split("`n")
  }

  $set = New-Object System.Collections.Generic.HashSet[string]
  foreach ($l in $lines) { [void]$set.Add($l.Trim()) }

  $changed = $false
  foreach ($n in $need) {
    if (!$set.Contains($n)) {
      $lines += $n
      $changed = $true
    }
  }

  $out = [string]::Join("`n", ($lines | Where-Object { $_ -ne $null }))
  Write-Utf8NoBom $path $out

  if ($changed) { Ok ("Patched: " + $path) } else { Warn ("No change needed: " + $path) }
}

function Ensure-TsconfigExclude([string]$tsconfigPath){
  if (!(Test-Path -LiteralPath $tsconfigPath)) { Fail ("Missing tsconfig: " + $tsconfigPath) }

  $bakDir = Join-Path $ProjRoot "_patch_bak\EXCLUDE_PATCH_BAK_FROM_BUILD_V1"
  Backup-File $tsconfigPath $bakDir "tsconfig"

  $raw = [System.IO.File]::ReadAllText($tsconfigPath)
  $raw = $raw -replace "`r`n","`n" -replace "`r","`n"

  # Parse JSON safely
  try {
    $obj = $raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Fail ("tsconfig.json is not valid JSON. Fix formatting first. Error: " + $_.Exception.Message)
  }

  $need = @(
    "_patch_bak",
    "**/_patch_bak/**",
    ".next",
    "**/.next/**",
    "node_modules"
  )

  if ($null -eq $obj.exclude) {
    $obj | Add-Member -NotePropertyName exclude -NotePropertyValue @() -Force
  }

  $existing = @()
  foreach ($e in $obj.exclude) { $existing += [string]$e }

  $changed = $false
  foreach ($n in $need) {
    if ($existing -notcontains $n) {
      $existing += $n
      $changed = $true
    }
  }

  $obj.exclude = $existing

  # Write JSON back with stable indentation
  $json = $obj | ConvertTo-Json -Depth 50
  Write-Utf8NoBom $tsconfigPath ($json + "`n")

  if ($changed) { Ok ("Patched exclude in: " + $tsconfigPath) } else { Warn ("Exclude already had required entries: " + $tsconfigPath) }
}

# MAIN
if (!(Test-Path -LiteralPath $ProjRoot)) { Fail ("ProjRoot not found: " + $ProjRoot) }

Ok "JRIDE Fix: exclude _patch_bak and .next from TS/ESLint build (V1)"

$tsconfig = Join-Path $ProjRoot "tsconfig.json"
Ensure-TsconfigExclude $tsconfig

$eslintIgnore = Join-Path $ProjRoot ".eslintignore"
Ensure-EslintIgnore $eslintIgnore

Ok "Patch complete."
