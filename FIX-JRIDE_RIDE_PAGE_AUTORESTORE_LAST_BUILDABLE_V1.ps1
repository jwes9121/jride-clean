# FIX-JRIDE_RIDE_PAGE_AUTORESTORE_LAST_BUILDABLE_V1.ps1
# Deterministic recovery: find the newest app\ride\page.tsx version that PASSES `npm.cmd run build`.
# Sources tried (in order):
#  1) Local backups: app\ride\page.tsx.bak.*
#  2) Git history commits that touched app\ride\page.tsx
# Stops at first successful build and keeps it. Restores original if none succeed.
# Patches ONLY: app\ride\page.tsx (but runs `npm.cmd run build`).

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Read-Utf8NoBom($path){
  if(!(Test-Path $path)){ Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
}
function Write-Utf8NoBom($path,$text){
  [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
}
function Backup($path,$suffix){
  $ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak = "$path.$suffix.$ts"
  Copy-Item -Force $path $bak
  Write-Host "[OK] Backup: $bak"
  return $bak
}
function Has-GitRepo(){
  try {
    $inside = & git rev-parse --is-inside-work-tree 2>$null
    return ($LASTEXITCODE -eq 0 -and $inside.Trim() -eq "true")
  } catch { return $false }
}

# Run build and return $true if success
function Run-Build($logPath){
  # Use cmd /c so npm.cmd resolves correctly
  $cmd = "npm.cmd run build"
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -NoNewWindow -Wait -PassThru -RedirectStandardOutput $logPath -RedirectStandardError $logPath
  return ($p.ExitCode -eq 0)
}

$root = (Get-Location).Path
$targetRel = "app\ride\page.tsx"
$target = Join-Path $root $targetRel
if(!(Test-Path $target)){ Fail "Not found: $targetRel" }

# Backup current file content so we can restore if needed
$origBackup = Backup $target "pre_autorestore_buildable"
$origText = Read-Utf8NoBom $target

# Prepare logs folder
$logDir = Join-Path $root "tmp_build_recovery_logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Build candidate list: backups first (newest first), then git commits (newest first)
$candidates = New-Object System.Collections.Generic.List[object]

# 1) Local backups
$baks = Get-ChildItem -Path ($target + ".bak.*") -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
foreach($b in $baks){
  $candidates.Add([pscustomobject]@{ kind="bak"; id=$b.Name; path=$b.FullName; content=$null })
}

# 2) Git commits for this file
if(Has-GitRepo){
  $commits = @()
  try { $commits = & git rev-list -n 80 HEAD -- $targetRel 2>$null } catch { $commits = @() }

  foreach($c in $commits){
    $c = $c.Trim()
    if(!$c){ continue }
    try {
      $content = & git show ($c + ":" + $targetRel) 2>$null
      if($LASTEXITCODE -ne 0 -or !$content){ continue }
      if($content -is [System.Array]){ $content = ($content -join "`n") }
      $candidates.Add([pscustomobject]@{ kind="git"; id=$c; path=$null; content=$content })
    } catch {}
  }
}

if($candidates.Count -lt 1){
  # restore original and fail
  Write-Utf8NoBom $target $origText
  Fail "No candidates found (no .bak backups and no git history candidates)."
}

Write-Host "[INFO] Candidates to try: $($candidates.Count)"
Write-Host "[INFO] This will run 'npm.cmd run build' repeatedly until one passes."

$success = $false
$winner = $null
$idx = 0

foreach($cand in $candidates){
  $idx++
  $label = "$($cand.kind)::$(($cand.id).ToString())"
  Write-Host ""
  Write-Host "[TRY $idx/$($candidates.Count)] $label"

  # Write candidate to target
  try {
    if($cand.kind -eq "bak"){
      Copy-Item -Force $cand.path $target
    } else {
      Write-Utf8NoBom $target $cand.content
    }
  } catch {
    Write-Host "[WARN] Could not write candidate: $label"
    continue
  }

  $logPath = Join-Path $logDir ("build_try_" + $idx.ToString("000") + "_" + ($cand.kind) + "_" + ($cand.id.ToString().Substring(0,[Math]::Min(12,$cand.id.ToString().Length))) + ".log")
  $ok = Run-Build $logPath

  if($ok){
    Write-Host "[OK] BUILD PASS with $label"
    $success = $true
    $winner = $cand
    break
  } else {
    Write-Host "[FAIL] Build failed for $label (log: $logPath)"
  }
}

if(!$success){
  # Restore original
  Write-Utf8NoBom $target $origText
  Write-Host ""
  Write-Host "[FAILED] No candidate produced a successful build."
  Write-Host "[RESTORED] Original file restored from pre-run snapshot."
  Write-Host "[LOGS] See: $logDir"
  exit 1
}

# Keep the winning file as-is, and create a restore tag backup
Backup $target "WINNER_buildable"
Write-Host ""
Write-Host "[DONE] Kept buildable app\ride\page.tsx from: $($winner.kind) :: $($winner.id)"
Write-Host "[LOGS] $logDir"
Write-Host ""
Write-Host "[NEXT] You may now run one final build to confirm:"
Write-Host "  npm.cmd run build"
