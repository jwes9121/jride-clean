# PATCH-JRIDE_PAX_SESSION_AND_CANBOOK_FIX_V2_PS5SAFE.ps1
# Fixes:
#  - NextResponse.json() called with 3 args (TypeScript error)
#  - can-book route uses req.cookies but GET/POST missing NextRequest param or wrong type

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; throw $m }

function Find-RepoRoot {
  $here = (Get-Location).Path
  $cur = $here
  while ($true) {
    if (Test-Path (Join-Path $cur ".git")) { return $cur }
    $parent = Split-Path -Parent $cur
    if ($parent -eq $cur -or [string]::IsNullOrWhiteSpace($parent)) { break }
    $cur = $parent
  }
  return $here
}

function Backup-File($path, $repoRoot){
  $bakDir = Join-Path $repoRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [IO.Path]::GetFileName($path)
  $bak = Join-Path $bakDir "$name.bak.$stamp"
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok ("[OK] Backup: {0}" -f $bak)
}

function Read-AllText($path){
  return [IO.File]::ReadAllText($path, [Text.UTF8Encoding]::new($false))
}

function Write-AllText($path, $text){
  [IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))
}

function Replace-Regex([string]$text, [string]$pattern, [string]$replacement, [ref]$count){
  $rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $m = $rx.Matches($text)
  $count.Value = $m.Count
  if ($m.Count -eq 0) { return $text }
  return $rx.Replace($text, $replacement)
}

function Ensure-Import-NextRequest([string]$text){
  # If already imports NextRequest, skip.
  if ($text -match 'import\s*\{\s*[^}]*\bNextRequest\b[^}]*\}\s*from\s*"next\/server"') { return $text }

  # If imports { NextResponse } from "next/server", expand to { NextResponse, NextRequest }
  $pat = 'import\s*\{\s*NextResponse\s*\}\s*from\s*"next\/server"\s*;'
  if ($text -match $pat) {
    return ($text -replace $pat, 'import { NextResponse, NextRequest } from "next/server";')
  }

  # If already imports something from next/server but not NextRequest, append inside braces.
  $pat2 = 'import\s*\{\s*([^}]*)\}\s*from\s*"next\/server"\s*;'
  if ($text -match $pat2) {
    return ([System.Text.RegularExpressions.Regex]::Replace(
      $text,
      $pat2,
      { param($mm)
        $inside = $mm.Groups[1].Value
        if ($inside -match '\bNextRequest\b') { return $mm.Value }
        $inside2 = $inside.Trim()
        if ([string]::IsNullOrWhiteSpace($inside2)) {
          return 'import { NextRequest } from "next/server";'
        }
        # add NextRequest at end
        return 'import { ' + $inside2.TrimEnd() + ', NextRequest } from "next/server";'
      },
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    ))
  }

  # Otherwise, add a new import line near top.
  return ('import { NextRequest } from "next/server";' + "`r`n" + $text)
}

function Fix-NextResponseJson-3Args([string]$text){
  # Transform:
  # NextResponse.json(payload, { status: 500 }, { headers: {...} })
  # -> NextResponse.json(payload, { status: 500, headers: {...} })
  #
  # Handles whitespace/newlines.
  $pattern = 'NextResponse\.json\(\s*(?<payload>\{[\s\S]*?\}|\[[\s\S]*?\]|"[\s\S]*?"|''[\s\S]*?''|[\s\S]*?)\s*,\s*\{\s*status\s*:\s*(?<status>\d+)\s*\}\s*,\s*\{\s*headers\s*:\s*(?<headers>\{[\s\S]*?\})\s*\}\s*\)'
  $replacement = 'NextResponse.json(${payload}, { status: ${status}, headers: ${headers} })'
  $c = 0
  $out = Replace-Regex $text $pattern $replacement ([ref]$c)
  if ($c -gt 0) { Ok ("[OK] session/route.ts: fixed {0} NextResponse.json(…,{status},{headers}) calls" -f $c) }
  return $out
}

function Ensure-Handler-Signature([string]$text, [string]$fnName){
  # Ensure: export async function GET(req: NextRequest)
  # Ensure: export async function POST(req: NextRequest)
  #
  # If it already has params, we normalize to (req: NextRequest) when it is () or (req: Request)
  $patNoArgs = ('export\s+async\s+function\s+' + $fnName + '\s*\(\s*\)')
  if ($text -match $patNoArgs) {
    $text = [System.Text.RegularExpressions.Regex]::Replace(
      $text,
      $patNoArgs,
      ('export async function ' + $fnName + '(req: NextRequest)'),
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    Ok ("[OK] can-book/route.ts: {0}() -> {0}(req: NextRequest)" -f $fnName)
    return $text
  }

  $patReqRequest = ('export\s+async\s+function\s+' + $fnName + '\s*\(\s*req\s*:\s*Request\s*\)')
  if ($text -match $patReqRequest) {
    $text = [System.Text.RegularExpressions.Regex]::Replace(
      $text,
      $patReqRequest,
      ('export async function ' + $fnName + '(req: NextRequest)'),
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    Ok ("[OK] can-book/route.ts: {0}(req: Request) -> {0}(req: NextRequest)" -f $fnName)
    return $text
  }

  # If it has some other param name/type, we leave it alone (avoid breaking).
  return $text
}

function Patch-SessionRoute($path, $repoRoot){
  if (!(Test-Path $path)) { Die "[ERR] Missing file: $path" }
  Backup-File $path $repoRoot

  $t = Read-AllText $path
  $before = $t

  $t = Fix-NextResponseJson-3Args $t

  if ($t -ne $before) {
    Write-AllText $path $t
    Ok ("[OK] Patched: {0}" -f $path)
  } else {
    Warn "[WARN] No changes applied to session/route.ts (maybe already fixed)."
  }
}

function Patch-CanBookRoute($path, $repoRoot){
  if (!(Test-Path $path)) { Die "[ERR] Missing file: $path" }
  Backup-File $path $repoRoot

  $t = Read-AllText $path
  $before = $t

  $t = Ensure-Import-NextRequest $t
  $t = Ensure-Handler-Signature $t "GET"
  $t = Ensure-Handler-Signature $t "POST"

  if ($t -ne $before) {
    Write-AllText $path $t
    Ok ("[OK] Patched: {0}" -f $path)
  } else {
    Warn "[WARN] No changes applied to can-book/route.ts (maybe already fixed)."
  }
}

Write-Host "== JRide Patch: Pax session + can-book compile fix (V2 / PS5-safe) ==" -ForegroundColor Cyan

$repoRoot = Find-RepoRoot
Ok ("[OK] RepoRoot: {0}" -f $repoRoot)

$sessionRoute = Join-Path $repoRoot "app\api\public\auth\session\route.ts"
$canBookRoute = Join-Path $repoRoot "app\api\public\passenger\can-book\route.ts"

Patch-SessionRoute $sessionRoute $repoRoot
Patch-CanBookRoute $canBookRoute $repoRoot

Ok "[OK] DONE. Next: npm.cmd run build"
