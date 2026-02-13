# PATCH-JRIDE_11C_CONTROL_CENTER_ADD_VERIFICATION_LINKS_V4.ps1
# ASCII-only. UTF8 NO BOM. Anchor-based. Adds verification links to Admin Control Center sections.
# Also fixes mojibake roleSource separator to ASCII.
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Timestamp(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadText($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [System.IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object System.Text.UTF8Encoding($false); [System.IO.File]::WriteAllText($p,$t,$enc) }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\control-center\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

$bak = "$target.bak.$(Timestamp)"
Copy-Item -Force $target $bak
Write-Host "[OK] Backup: $bak"

$txt = ReadText $target
$orig = $txt

# 0) Fix mojibake separator in roleSource display (ASCII-only replacement)
# From your file: {roleSource ? `Ãƒâ€š· ${roleSource}` : ""}
$txt = $txt.Replace("Ãƒâ€š·", " - ")

# 1) Insert two items under Core Admin -> items: [ ... ]
if($txt -match 'href:\s*"/admin/verification"' -or $txt -match 'href:\s*"/admin/dispatcher-verifications"'){
  Write-Host "[SKIP] Verification links already present in sections."
} else {
  $anchor = 'heading:\s*"Core Admin"\s*,\s*items:\s*\['
  $m = [regex]::Match($txt, $anchor)
  if(-not $m.Success){
    Fail 'ANCHOR NOT FOUND: Could not locate Core Admin items array.'
  }

  # Insert right after the opening items: [
  $insertPos = $m.Index + $m.Length

  $block = @'
          {
            title: "Passenger Verification (Admin)",
            desc: "Approve or reject passenger verification requests.",
            href: "/admin/verification",
          },
          {
            title: "Passenger Verification (Dispatcher)",
            desc: "Pre-approve and forward to Admin queue.",
            href: "/admin/dispatcher-verifications",
          },

'@

  $txt = $txt.Substring(0,$insertPos) + "`r`n" + $block + $txt.Substring($insertPos)
  Write-Host "[OK] Inserted verification links into Core Admin section."
}

# 2) Allow dispatcher role to see dispatcher-verifications page
# Add to dispatcherAllow Set<string>([ ... ])
if($txt -match '"/admin/dispatcher-verifications"'){
  # only add to allowlist if not already there
  if($txt -match 'dispatcherAllow\.has' -and $txt -notmatch '"/admin/dispatcher-verifications"\s*,'){
    $setAnchor = 'new Set<string>\(\[\s*'
    $m2 = [regex]::Match($txt, $setAnchor)
    if(-not $m2.Success){
      Fail 'ANCHOR NOT FOUND: Could not locate dispatcherAllow Set<string>([ ... ]).'
    }
    $pos2 = $m2.Index + $m2.Length
    $txt = $txt.Substring(0,$pos2) + "`r`n        " + '"/admin/dispatcher-verifications",' + $txt.Substring($pos2)
    Write-Host "[OK] Added /admin/dispatcher-verifications to dispatcher allowlist."
  } else {
    # If allowlist already contains it, skip
    if($txt -match '"/admin/dispatcher-verifications"\s*,'){
      Write-Host "[SKIP] Dispatcher allowlist already contains /admin/dispatcher-verifications."
    } else {
      Write-Host "[WARN] Could not confidently patch dispatcher allowlist (pattern mismatch)."
    }
  }
}

if($txt -eq $orig){
  Fail "No changes made (unexpected). Aborting without write."
}

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
