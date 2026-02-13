# PATCH-JRIDE_PASSENGER_UI_BADGE_SEPARATOR_FORCE_SAFE_V3_ASCII.ps1
# ASCII-only PS1 (no mojibake literals)
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES
# Patches ONLY: app\passenger\page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function Read-Utf8NoBom($path){
  if(!(Test-Path $path)){ Fail "Missing file: $path" }
  [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
}
function Write-Utf8NoBom($path,$text){
  [System.IO.File]::WriteAllText($path,$text,[System.Text.UTF8Encoding]::new($false))
}
function Backup-File($path){
  $ts=(Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak="$path.bak.$ts"
  Copy-Item -Force $path $bak
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$target = Join-Path $root "app\passenger\page.tsx"
if(!(Test-Path $target)){ Fail "Not found: $target" }

Backup-File $target
$t0 = Read-Utf8NoBom $target
$t  = $t0

# ---- Build characters without embedding non-ASCII in the PS1 ----
$middot = [char]0x00B7        # ·
$Acirc  = [char]0x00C2        # 

$middotS = [string]$middot
$AcircS  = [string]$Acirc

$badDot  = $AcircS + $middotS # "·"

# ---- 1) Scrub bad dot sequences globally ----
$t = $t.Replace($badDot, $middotS)

# Remove stray "" if any (string->string overload)
$t = $t.Replace($AcircS, "")

# ---- 2) Force canonical badge separator span block to use {" · "} ----
$jsxDot = '{" ' + $middotS + ' "}'  # yields {" · "}

# Match the opacity-70 span that contains the status mapping expression (multi-line safe)
$pattern = '<span className="opacity-70">.*?\{status === "authenticated" \? "authenticated" : status === "unauthenticated" \? "unauthenticated" : "loading"\}.*?</span>'
$rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

if($rx.IsMatch($t)){
  $replacement = @(
'            <span className="opacity-70">',
('              ' + $jsxDot),
'              {status === "authenticated" ? "authenticated" : status === "unauthenticated" ? "unauthenticated" : "loading"}',
'            </span>'
) -join "`n"
  $t = $rx.Replace($t, $replacement, 1)
  Write-Host "[OK] Forced canonical badge separator span block."
} else {
  # Fallback: legacy one-liner patterns
  $t = $t.Replace('<span className="opacity-70"> · {status}</span>', '<span className="opacity-70">' + $jsxDot + '{status}</span>')
}

# ---- 3) Write file ----
Write-Utf8NoBom $target $t

if($t -eq $t0){
  Write-Host "[OK] No changes were necessary (file already clean locally)."
  Write-Host "If production still shows a bad dot, Vercel is likely serving an older deployment/branch."
} else {
  Write-Host "[OK] Changes applied to passenger badge separator."
}

Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "[DONE]"
