# PATCH-JRIDE_PHASE8E_ARRIVED_UI_POLISH.ps1
# هدف: Make 'arrived' visible in LiveTrips (page-data filter) + small UI polish.
# - Adds arrived to active status filters in page-data + summary endpoints (if present)
# - Ensures LiveTripsClient treats arrived as active + labels it clearly
# - Backups are created for every touched file

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw "[FAIL] $m" }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

function Backup-File([string]$path){
  if(!(Test-Path $path)){ Fail "File not found: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force
  return $bak
}

function Write-IfChanged([string]$path, [string]$newText, [ref]$changed){
  $old = Get-Content $path -Raw
  if($old -ne $newText){
    Set-Content -Path $path -Value $newText -Encoding UTF8
    $changed.Value = $true
    Ok "Wrote: $path"
  } else {
    Info "No change: $path"
  }
}

# Adds 'arrived' inside common Supabase status filters.
function Patch-StatusFiltersToIncludeArrived([string]$path){
  $changed = $false
  $bak = Backup-File $path
  $txt = Get-Content $path -Raw

  # Pattern A: status=in.(assigned,on_the_way,on_trip)
  $beforeA = $txt
  $txt = [regex]::Replace(
    $txt,
    'status=in\.\(([^)]*)\)',
    {
      param($m)
      $inside = $m.Groups[1].Value
      # Only touch if it looks like a status list and arrived isn't present
      if($inside -match 'assigned|on_the_way|on_trip|pending|enroute' -and $inside -notmatch '(^|,)arrived(,|$)'){
        # insert arrived after on_the_way if present, else append
        if($inside -match 'on_the_way'){
          $inside2 = $inside -replace '(on_the_way)(,?)', '$1,arrived,'
          # clean double commas
          $inside2 = $inside2 -replace ',{2,}', ','
          $inside2 = $inside2.Trim(',')
          return "status=in.($inside2)"
        } else {
          $inside2 = ($inside.Trim(',') + ",arrived")
          $inside2 = $inside2 -replace ',{2,}', ','
          return "status=in.($inside2)"
        }
      }
      return $m.Value
    },
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if($txt -ne $beforeA){ $changed = $true }

  # Pattern B: ["assigned","on_the_way","on_trip"] style arrays
  $beforeB = $txt
  $txt = [regex]::Replace(
    $txt,
    '\[\s*"(?:pending|assigned|on_the_way|on_trip|enroute|searching)"(?:\s*,\s*"(?:pending|assigned|on_the_way|on_trip|enroute|searching)")+\s*\]',
    {
      param($m)
      $arr = $m.Value
      if($arr -match '"on_the_way"' -and $arr -notmatch '"arrived"'){
        # insert "arrived" right after "on_the_way"
        $arr2 = $arr -replace '("on_the_way"\s*,)', '$1 "arrived",'
        return $arr2
      }
      if($arr -match '"assigned"' -and $arr -notmatch '"arrived"' -and $arr -match '"on_trip"'){
        # if no on_the_way, append arrived after assigned
        $arr2 = $arr -replace '("assigned"\s*,)', '$1 "arrived",'
        return $arr2
      }
      return $arr
    },
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if($txt -ne $beforeB){ $changed = $true }

  if($changed){
    Set-Content -Path $path -Value $txt -Encoding UTF8
    Ok "Patched status filters to include 'arrived': $path"
    Ok "Backup: $bak"
    return $true
  } else {
    Warn "No matching status filter patterns changed in: $path"
    Info "Backup (created anyway): $bak"
    return $false
  }
}

# Adds UI label polish in LiveTripsClient:
# - Ensure any status label mapping supports arrived
# - Ensure action label shows arrived = pickup reached
function Patch-LiveTripsClientArrivedPolish([string]$path){
  $changed = $false
  $bak = Backup-File $path
  $txt = Get-Content $path -Raw

  # 1) Insert a small helper (only once) for a friendly status label.
  if($txt -notmatch 'function\s+prettyStatus\('){
    $anchor = 'function\s+normStatus\('
    $m = [regex]::Match($txt, $anchor)
    if($m.Success){
      $insert = @"
function prettyStatus(s: any) {
  const v = String(s ?? "").trim().toLowerCase().replace(/[\s\-]+/g, "_");
  if (v === "arrived") return "arrived (pickup reached)";
  if (v === "on_the_way") return "on_the_way";
  if (v === "on_trip") return "on_trip";
  return v || "requested";
}

"@
      $txt = $txt.Insert($m.Index, $insert)
      $changed = $true
      Ok "Inserted prettyStatus() helper."
    } else {
      Warn "Could not find normStatus() anchor; skipping prettyStatus insert."
    }
  } else {
    Info "prettyStatus() already exists."
  }

  # 2) Replace UI status display where it prints Status: <something>
  # Try a safe replace of "Status:" line in Trip actions panel.
  $before = $txt
  $txt = [regex]::Replace(
    $txt,
    'Status:\s*\{[^}]*\}',
    'Status: {prettyStatus(selectedTrip?.status)}',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if($txt -ne $before){
    $changed = $true
    Ok "Polished Trip actions status display (prettyStatus)."
  }

  # 3) Ensure "arrived" is considered active in any "ACTIVE_STATUSES" / "activeStatuses" lists if present.
  $before2 = $txt
  $txt = [regex]::Replace(
    $txt,
    '(ACTIVE_STATUSES\s*=\s*\[[^\]]*)\]',
    {
      param($m)
      $block = $m.Value
      if($block -match '"arrived"' -or $block -match "'arrived'"){ return $block }
      if($block -match 'on_the_way' -or $block -match 'on_trip' -or $block -match 'assigned'){
        # Insert arrived after on_the_way if present
        if($block -match 'on_the_way'){
          $block2 = $block -replace '(on_the_way["'']?\s*,)', '$1 "arrived",'
          $block2 = $block2 -replace ',\s*,', ','
          return $block2
        } else {
          $block2 = $block.TrimEnd(']') + ', "arrived"]'
          return $block2
        }
      }
      return $block
    },
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if($txt -ne $before2){
    $changed = $true
    Ok "Ensured arrived is included in ACTIVE_STATUSES list."
  }

  # 4) Ensure action resolver recognizes "arrived" step if it uses a NEXT map / allowedTransitions map
  $before3 = $txt
  $txt = [regex]::Replace(
    $txt,
    'on_the_way"\s*:\s*\[([^\]]*)\]',
    {
      param($m)
      $inside = $m.Groups[1].Value
      if($inside -match 'arrived'){ return $m.Value }
      # add "arrived" as first option if missing
      $inside2 = '"arrived", ' + $inside.Trim()
      return 'on_the_way": [' + $inside2 + ']'
    },
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if($txt -ne $before3){
    $changed = $true
    Ok "Added 'arrived' as a valid next step from on_the_way in frontend transitions (if present)."
  }

  if($changed){
    Set-Content -Path $path -Value $txt -Encoding UTF8
    Ok "Patched LiveTripsClient UI polish: $path"
    Ok "Backup: $bak"
    return $true
  } else {
    Warn "No changes applied to LiveTripsClient (layout may already include these)."
    Info "Backup (created anyway): $bak"
    return $false
  }
}

# --------- MAIN ----------
$root = Get-Location
Info "Repo root: $root"

$targets = @(
  "app\api\admin\livetrips\page-data\route.ts",
  "app\api\admin\livetrips\summary\route.ts",
  "app\api\admin\livetrips\pending\route.ts"
) | Where-Object { Test-Path $_ }

if($targets.Count -eq 0){
  Warn "No /admin/livetrips API route targets found in expected paths."
  Warn "Search your repo for: app\api\admin\livetrips\page-data\route.ts"
} else {
  foreach($t in $targets){
    Info "Patching filter: $t"
    [void](Patch-StatusFiltersToIncludeArrived $t)
  }
}

$client = "app\admin\livetrips\LiveTripsClient.tsx"
if(Test-Path $client){
  Info "Patching UI: $client"
  [void](Patch-LiveTripsClientArrivedPolish $client)
} else {
  Warn "LiveTripsClient not found at: $client"
}

Ok "Done. Next: run build and test arrived visibility in /admin/livetrips."
