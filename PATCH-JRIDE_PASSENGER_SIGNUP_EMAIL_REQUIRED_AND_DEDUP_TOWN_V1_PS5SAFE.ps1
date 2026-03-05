param(
  [Parameter(Mandatory=$true)][string]$WebRoot
)

$ErrorActionPreference="Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Backup([string]$path, [string]$tag) {
  $bakDir = Join-Path $WebRoot "_patch_bak"
  New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
  $leaf = Split-Path $path -Leaf
  $bak = Join-Path $bakDir ("$leaf.bak.$tag.$ts")
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

Write-Host "== PATCH JRIDE: Passenger signup email REQUIRED + remove duplicate town section (V1 / PS5-safe) =="

if (!(Test-Path -LiteralPath $WebRoot)) { throw "WebRoot not found: $WebRoot" }

# 1) Locate Passenger Signup page by heading text
$tsFiles = Get-ChildItem -Path $WebRoot -Recurse -File -Include *.ts,*.tsx | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\\.next\\' }

$signupHit = $tsFiles | Where-Object {
  (Select-String -LiteralPath $_.FullName -SimpleMatch -Pattern "Passenger Signup" -Quiet)
} | Select-Object -First 1

if (!$signupHit) { throw "Could not find the file containing 'Passenger Signup' heading." }

$signupPath = $signupHit.FullName
Backup $signupPath "PASSENGER_SIGNUP_FIX_V1"
Write-Host "[OK] Target signup page: $signupPath"

$src = Get-Content -LiteralPath $signupPath -Raw -Encoding UTF8
$orig = $src

# 2) Make Email required (UI label + required attr + placeholder)
# - Change label from "Email (optional)" to "Email"
$src = $src -replace 'Email\s*\(optional\)', 'Email'

# - Ensure email input has required attribute:
#   We match the email input block by type="email" and inject required if missing.
if ($src -match 'type\s*=\s*["'']email["'']' -and $src -notmatch 'type\s*=\s*["'']email["''][\s\S]{0,200}required') {
  $src = [regex]::Replace(
    $src,
    '(type\s*=\s*["'']email["''][\s\S]{0,200}?)(/?>)',
    '$1 required$2',
    1
  )
  Write-Host "[OK] Added required to email input."
} else {
  Write-Host "[WARN] Email required attribute not injected (either already required or email input not matched)."
}

# 3) Remove duplicated Town/Barangay REQUIRED block (bottom section)
# We delete the SECOND occurrence of a required Town label block: "Town of origin *" (or similar)
# This is conservative: removes the required * block only, leaving the dropdown town selector.
$reDupTown = [regex]::new('(?s)\r?\n\s*<[^>]*>\s*Town of origin\s*\*\s*<\/[^>]*>\s*.*?\r?\n\s*<[^>]*>\s*Barangay\s*\(optional\)\s*<\/[^>]*>\s*.*?\r?\n', 'Singleline')
if ($reDupTown.IsMatch($src)) {
  $src = $reDupTown.Replace($src, "`r`n", 1)
  Write-Host "[OK] Removed duplicated required Town/Barangay block."
} else {
  Write-Host "[WARN] Did not find the duplicated required Town/Barangay block by label text."
}

# 4) Add client-side enforcement in submit handler: block if email empty
# Look for handleSubmit and add a guard near top
if ($src -match 'function\s+handleSubmit|const\s+handleSubmit' -and $src -notmatch 'Email is required') {
  $src = [regex]::Replace(
    $src,
    '(handleSubmit[\s\S]{0,400}?\{\s*)([\s\S]{0,200}?)',
    '$1' + "`r`n" +
    '    // JRIDE_EMAIL_REQUIRED_V1' + "`r`n" +
    '    try {' + "`r`n" +
    '      if (!email || String(email).trim().length === 0) {' + "`r`n" +
    '        setMessage?.("Email is required.");' + "`r`n" +
    '        return;' + "`r`n" +
    '      }' + "`r`n" +
    '    } catch (_) {}' + "`r`n" +
    '$2',
    1
  )
  Write-Host "[OK] Added client-side email required guard in submit handler (best-effort)."
} else {
  Write-Host "[WARN] Could not inject submit guard (handleSubmit not matched or already present)."
}

if ($src -eq $orig) { throw "Signup page: no changes applied. Aborting to avoid false green." }

Write-Utf8NoBom $signupPath $src
Write-Host "[OK] Wrote: $signupPath"

# 5) Patch server route (best-effort): find the API route used by signup fetch
# We look for fetch("/api/") in the signup page and patch that route's POST to require email.
$apiPath = $null
$m = [regex]::Match($src, 'fetch\(\s*["''](?<p>\/api\/[^"'']+)["'']')
if ($m.Success) {
  $apiPath = $m.Groups['p'].Value
  Write-Host "[OK] Detected signup API call: $apiPath"
} else {
  Write-Host "[WARN] Could not detect fetch('/api/...') in signup page. Skipping backend enforcement."
}

if ($apiPath) {
  # convert /api/x/y to app/api/x/y/route.ts
  $routeRel = ("app" + $apiPath.Replace("/api", "\api").Replace("/", "\") + "\route.ts")
  $routeFull = Join-Path $WebRoot $routeRel

  if (Test-Path -LiteralPath $routeFull) {
    Backup $routeFull "PASSENGER_SIGNUP_API_EMAIL_REQUIRED_V1"
    $r = Get-Content -LiteralPath $routeFull -Raw -Encoding UTF8
    $rOrig = $r

    if ($r -notmatch 'JRIDE_EMAIL_REQUIRED_API_V1') {
      # Insert check after req.json() destructure if present, else after first json parse line.
      $r = [regex]::Replace(
        $r,
        '(\=\s*await\s*req\.json\(\)\s*;)',
        '$1' + "`r`n" +
        '  // JRIDE_EMAIL_REQUIRED_API_V1' + "`r`n" +
        '  if (!body?.email || String(body.email).trim().length === 0) {' + "`r`n" +
        '    return NextResponse.json({ ok: false, error: "Email is required" }, { status: 400 });' + "`r`n" +
        '  }',
        1
      )

      # If the route doesn't use "body" variable, try destructure style:
      if ($r -eq $rOrig) {
        $r = [regex]::Replace(
          $r,
          '(const\s*\{\s*[^}]*email[^}]*\}\s*=\s*await\s*req\.json\(\)\s*;)',
          '$1' + "`r`n" +
          '  // JRIDE_EMAIL_REQUIRED_API_V1' + "`r`n" +
          '  if (!email || String(email).trim().length === 0) {' + "`r`n" +
          '    return NextResponse.json({ ok: false, error: "Email is required" }, { status: 400 });' + "`r`n" +
          '  }',
          1
        )
      }

      if ($r -eq $rOrig) {
        Write-Host "[WARN] Backend route found but could not inject email required check (pattern mismatch)."
      } else {
        Write-Utf8NoBom $routeFull $r
        Write-Host "[OK] Patched backend route: $routeFull"
      }
    } else {
      Write-Host "[OK] Backend already has JRIDE_EMAIL_REQUIRED_API_V1."
    }
  } else {
    Write-Host "[WARN] Detected API path but route file not found at: $routeFull"
  }
}

Write-Host ""
Write-Host "== DONE =="
Write-Host "Next: npm run build, then commit/tag/push."