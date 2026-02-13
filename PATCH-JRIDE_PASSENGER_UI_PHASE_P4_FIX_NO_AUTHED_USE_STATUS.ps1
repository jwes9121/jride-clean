# PATCH-JRIDE_PASSENGER_UI_PHASE_P4_FIX_NO_AUTHED_USE_STATUS.ps1
# UI_ONLY / NO_BACKEND_CHANGES / NO_NEW_APIS / NO_MAPBOX_CHANGES
# Fix: ride page has no `authed` var; use `status === "authenticated"` inside PHASE P4 block.
# Patches ONLY: app\ride\page.tsx

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
function Replace-Once($text,$from,$to,$label){
  $i = $text.IndexOf($from)
  if($i -lt 0){ Fail "Anchor not found ($label)." }
  return $text.Substring(0,$i) + $to + $text.Substring($i + $from.Length)
}

$root = (Get-Location).Path
$target = Join-Path $root "app\ride\page.tsx"
if(!(Test-Path $target)){ Fail "Not found: $target" }

Backup-File $target
$t = Read-Utf8NoBom $target

# Ensure PHASE P4 block exists
$start = "/* ===== PHASE P4: Preflight panel (UI-only) ===== */"
$end   = "/* ===== END PHASE P4 ===== */"

$ps = $t.IndexOf($start)
$pe = $t.IndexOf($end)
if($ps -lt 0 -or $pe -lt 0 -or $pe -le $ps){
  Fail "PHASE P4 panel markers not found. Ensure PHASE P4 script was applied."
}

$block = $t.Substring($ps, ($pe - $ps) + $end.Length)

# Replace the authed usage ONLY inside the P4 panel block
# 1) p4Preflight(result, authed) -> p4Preflight(result, status === "authenticated")
$block2 = $block.Replace("p4Preflight(result, authed)", "p4Preflight(result, status === ""authenticated"")")

# 2) Signed in field: authed ? "yes" : "no" -> status === "authenticated" ? "yes" : "no"
$block2 = $block2.Replace('{authed ? "yes" : "no"}', '{status === "authenticated" ? "yes" : "no"}')

# 3) Any remaining raw `authed` tokens inside the P4 block should be removed safely
# (If we still find "authed" here, hard fail so we don't leave broken code)
if($block2.IndexOf("authed") -ge 0){
  Fail "PHASE P4 block still contains 'authed' after replacements. Paste the PHASE P4 block from ride/page.tsx."
}

# Write back
$t = $t.Substring(0,$ps) + $block2 + $t.Substring($ps + $block.Length)

Write-Utf8NoBom $target $t
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Run build:"
Write-Host "  npm.cmd run build"
