$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK]  $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Die($m){ throw $m }

function Find-RepoRoot([string]$StartDir){
  $dir = Resolve-Path -LiteralPath $StartDir
  while($true){
    $pkg = Join-Path -Path $dir -ChildPath "package.json"
    if(Test-Path -LiteralPath $pkg){ return $dir.Path }
    $parent = Split-Path -Path $dir -Parent
    if(-not $parent -or $parent -eq $dir.Path){ break }
    $dir = $parent
  }
  throw "Could not find repo root (package.json) from: $StartDir"
}

Write-Host "== JRide Patch: Signup requires town_origin + store in Auth metadata (V1 / PS5-safe) =="

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Find-RepoRoot $scriptDir
Ok "RepoRoot: $repoRoot"

$targetRel = "app\api\public\auth\signup\route.ts"
$target = Join-Path -Path $repoRoot -ChildPath $targetRel
if(-not (Test-Path -LiteralPath $target)){ Die "Missing target: $targetRel" }
Ok "Target: $target"

$bakDir = Join-Path $repoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("route.ts.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "Backup: $bak"

$src = Get-Content -LiteralPath $target -Raw

# 1) Insert town_origin extraction + required check right after JSON body parse.
# We try to find a line like: const body = await req.json() ...
$bodyParsePattern = '(?m)^\s*const\s+body\s*=\s*await\s+req\.json\(\)\s*;?\s*$'
if($src -notmatch $bodyParsePattern){
  # Some files use: const body = (await req.json().catch(() => ({}))) ...
  $bodyParsePattern = '(?m)^\s*const\s+body\s*=\s*\(?\s*await\s+req\.json\(\)[^;\n]*;?\s*$'
}
if($src -notmatch $bodyParsePattern){
  Die "Could not find body JSON parse line (const body = await req.json()). Open $targetRel and ensure it parses req.json() into 'body'."
}

$injection = @"
`n  // JRIDE_TOWN_ORIGIN_REQUIRED_V1
  const town_origin = String((body as any)?.town_origin ?? "").trim();
  const barangay_origin = String((body as any)?.barangay_origin ?? "").trim();
  if (!town_origin) {
    return NextResponse.json(
      { ok: false, error: "TOWN_ORIGIN_REQUIRED", message: "Town of origin is required during signup." },
      { status: 400 }
    );
  }
"@

# Insert only if not already present
if($src -match 'JRIDE_TOWN_ORIGIN_REQUIRED_V1'){
  Warn "Town-origin requirement block already present. Skipping injection."
} else {
  $src = [regex]::Replace($src, $bodyParsePattern, { param($m) $m.Value + $injection }, 1)
  Ok "Injected town_origin requirement after body parse."
}

# 2) Ensure Supabase signup/otp create includes metadata.
# We will attempt to patch these common patterns:
# - supabase.auth.signUp({ ... })
# - supabase.auth.signInWithOtp({ ... })
# - supabase.auth.admin.createUser({ ... user_metadata ... })
#
# We add/merge options/data or user_metadata with town/barangay.

function Ensure-MetadataInCall([string]$text, [string]$callName){
  $t = $text

  # signUp({...}) -> ensure options: { data: { town_origin, barangay_origin } }
  if($callName -eq "signUp"){
    $pat = '(?s)supabase\.auth\.signUp\s*\(\s*\{(.*?)\}\s*\)'
    if($t -match $pat){
      $t = [regex]::Replace($t, $pat, {
        param($m)
        $inside = $m.Groups[1].Value

        # If already has options: { data: ... } just return unchanged
        if($inside -match '(?s)\boptions\s*:'){
          return $m.Value
        }

        $inside2 = $inside.TrimEnd()
        if($inside2.Length -gt 0 -and $inside2.Trim().EndsWith("," ) -eq $false){
          $inside2 = $inside2 + ","
        }
        return "supabase.auth.signUp({`n" + $inside2 + "`n  options: { data: { town_origin, barangay_origin } }`n})"
      }, 1)
      return $t
    }
  }

  # signInWithOtp({...}) -> ensure options: { data: { town_origin, barangay_origin } }
  if($callName -eq "signInWithOtp"){
    $pat = '(?s)supabase\.auth\.signInWithOtp\s*\(\s*\{(.*?)\}\s*\)'
    if($t -match $pat){
      $t = [regex]::Replace($t, $pat, {
        param($m)
        $inside = $m.Groups[1].Value
        if($inside -match '(?s)\boptions\s*:'){
          return $m.Value
        }
        $inside2 = $inside.TrimEnd()
        if($inside2.Length -gt 0 -and $inside2.Trim().EndsWith("," ) -eq $false){
          $inside2 = $inside2 + ","
        }
        return "supabase.auth.signInWithOtp({`n" + $inside2 + "`n  options: { data: { town_origin, barangay_origin } }`n})"
      }, 1)
      return $t
    }
  }

  # admin.createUser({...}) -> ensure user_metadata: { town_origin, barangay_origin }
  if($callName -eq "adminCreateUser"){
    $pat = '(?s)supabase\.auth\.admin\.createUser\s*\(\s*\{(.*?)\}\s*\)'
    if($t -match $pat){
      $t = [regex]::Replace($t, $pat, {
        param($m)
        $inside = $m.Groups[1].Value
        if($inside -match '(?s)\buser_metadata\s*:'){
          return $m.Value
        }
        $inside2 = $inside.TrimEnd()
        if($inside2.Length -gt 0 -and $inside2.Trim().EndsWith("," ) -eq $false){
          $inside2 = $inside2 + ","
        }
        return "supabase.auth.admin.createUser({`n" + $inside2 + "`n  user_metadata: { town_origin, barangay_origin }`n})"
      }, 1)
      return $t
    }
  }

  return $t
}

$before = $src
$src = Ensure-MetadataInCall $src "signUp"
$src = Ensure-MetadataInCall $src "signInWithOtp"
$src = Ensure-MetadataInCall $src "adminCreateUser"

if($src -eq $before){
  Warn "Did not detect a direct Supabase signup/OTP/admin.createUser call to patch. That's OK if your route forwards to another helper, but ensure town_origin is passed into whichever auth create call is used."
} else {
  Ok "Patched Supabase auth create call with town_origin metadata (where detected)."
}

Set-Content -LiteralPath $target -Value $src -Encoding UTF8
Ok "Patched: $targetRel"

Ok "DONE. Next: build, then update the UI caller to send town_origin in the /api/public/auth/signup request."
