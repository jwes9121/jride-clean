# PATCH-JRIDE_VERIFICATION_SUBMIT_DISABLE_UNTIL_UPLOADS_V1.ps1
# Disables Submit button until idFrontPath + selfiePath exist (if those states exist).
# ASCII-only. UTF-8 no BOM. Backup included.

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function ReadU($p){ [IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false)) }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }
function Fail($m){ throw $m }

$root = Get-Location
$stamp = NowStamp
$f = Join-Path $root "app\verification\page.tsx"
if(!(Test-Path $f)){ Fail "Missing: $f" }

Copy-Item $f "$f.bak.$stamp" -Force
$txt = ReadU $f

# Only patch if upload states exist
$hasId = ($txt -match '\bidFrontPath\b')
$hasSelfie = ($txt -match '\bselfiePath\b')
if(-not ($hasId -and $hasSelfie)){
  Write-Host "[SKIP] idFrontPath/selfiePath not found in app/verification/page.tsx. No change."
  exit 0
}

# Inject canSubmit helper near status flags (best-effort)
if($txt -notmatch '\bconst\s+canSubmit\b'){
  $anchor = [regex]::Match($txt, 'const\s+isRejected\s*=\s*[^;]+;\s*')
  if(-not $anchor.Success){ Fail "Could not find status flags anchor (isRejected) to inject canSubmit." }

  $ins = @'
const hasUploads = Boolean(String(idFrontPath || "").trim()) && Boolean(String(selfiePath || "").trim());
const canSubmit = hasUploads && Boolean(String(fullName || "").trim()) && Boolean(String(town || "").trim()) && !isApproved && !isPending;
'@

  $txt = $txt.Insert($anchor.Index + $anchor.Length, "`r`n$ins`r`n")
}

# Patch the Submit button disabled logic + styling
# Finds the button that contains "Submit for verification"
$mBtn = [regex]::Match($txt, '(?s)<button[^>]*>\s*\{[^}]*\}\s*:\s*"Submit for verification"\s*\}\s*</button>')
if(-not $mBtn.Success){
  # fallback: look for literal text
  $mBtn = [regex]::Match($txt, '(?s)<button[^>]*>\s*[^<]*Submit for verification[^<]*\s*</button>')
}
if(-not $mBtn.Success){ Fail "Could not find the Submit for verification button." }

$btn = $mBtn.Value

# Replace disabled={saving} or disabled={...} with disabled={saving || !canSubmit}
if($btn -match 'disabled=\{[^}]+\}'){
  $btn2 = [regex]::Replace($btn, 'disabled=\{[^}]+\}', 'disabled={saving || !canSubmit}', 1)
} else {
  $btn2 = $btn -replace '<button', '<button disabled={saving || !canSubmit}', 1
}

# Replace className conditional to include gray disabled state
# If there's already a className={...} keep it, but enforce a disabled look when !canSubmit
if($btn2 -match 'className=\{'){
  $btn2 = [regex]::Replace(
    $btn2,
    'className=\{(?s)(.*?)\}',
    'className={"rounded-xl px-4 py-2 font-semibold text-white " + ((saving || !canSubmit) ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500")}',
    1
  )
} else {
  $btn2 = $btn2 -replace '<button', '<button className={"rounded-xl px-4 py-2 font-semibold text-white " + ((saving || !canSubmit) ? ' +
    '"bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500")}', 1
}

# Add helper hint text if missing
if($btn2 -notmatch 'Please upload both'){
  $hint = @'
{(!canSubmit && !saving) ? (
  <div className="text-xs text-slate-600 mt-2">Please upload BOTH photos and fill name + town to enable submit.</div>
) : null}
'@
  $btn2 = $btn2 + "`r`n" + $hint
}

$txt = $txt.Remove($mBtn.Index, $mBtn.Length).Insert($mBtn.Index, $btn2)

WriteU $f $txt
Write-Host "[OK] Patched: submit disabled until uploads exist."
Write-Host "[OK] Backup: $f.bak.$stamp"
