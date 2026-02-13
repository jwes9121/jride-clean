$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

if (!(Test-Path ".\package.json")) { Fail "Run from repo root (package.json missing)." }
if (!(Test-Path ".\app")) { Fail "Expected ./app folder (App Router)." }

$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")

function ReadText($path){
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}
function WriteText($path, $text){
  [System.IO.File]::WriteAllText($path, $text, [System.Text.Encoding]::UTF8)
}
function Backup($path){
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force
  Ok "[OK] Backup: $bak"
}

function FindPageByNeedle($needle){
  $hits = @()
  $files = Get-ChildItem -Path ".\app" -Recurse -Filter "page.tsx" -File
  foreach ($f in $files) {
    $p = $f.FullName
    $t = ReadText $p
    if ($t -like "*$needle*") { $hits += $p }
  }
  return $hits
}

# Locate pages without assuming paths
$loginHits  = FindPageByNeedle "Passenger Login"
$signupHits = FindPageByNeedle "Passenger Signup"

if ($loginHits.Count -eq 0)  { Fail "Could not find Passenger Login page.tsx under ./app" }
if ($signupHits.Count -eq 0) { Fail "Could not find Passenger Signup page.tsx under ./app" }

$loginPath = ($loginHits | Where-Object { $_ -match "\\passenger-login\\page\.tsx$" } | Select-Object -First 1)
if (-not $loginPath) { $loginPath = $loginHits[0] }

$signupPath = ($signupHits | Where-Object { $_ -match "\\passenger-signup\\page\.tsx$" } | Select-Object -First 1)
if (-not $signupPath) { $signupPath = $signupHits[0] }

Ok "[OK] Login page:  $loginPath"
Ok "[OK] Signup page: $signupPath"

Backup $loginPath
Backup $signupPath

# -------------------------
# Patch LOGIN page
# -------------------------
$login = ReadText $loginPath

# 1) Ensure next/navigation import includes useRouter (or add import)
if ($login -notmatch '\buseRouter\b') {
  if ($login -match '(?m)^\s*import\s*\{\s*([^\}]+)\s*\}\s*from\s*["'']next/navigation["''];\s*$') {
    $login = [regex]::Replace(
      $login,
      '(?m)^\s*import\s*\{\s*([^\}]+)\s*\}\s*from\s*["'']next/navigation["''];\s*$',
      { param($m)
        $inside = $m.Groups[1].Value
        if ($inside -match '\buseRouter\b') { return $m.Value }
        return "import { $inside, useRouter } from ""next/navigation"";"
      },
      1
    )
  } else {
    # Add import after React import, or after "use client";
    if ($login -match '(?m)^\s*import\s+\*\s+as\s+React\s+from\s+["'']react["''];\s*$') {
      $login = [regex]::Replace(
        $login,
        '(?m)^\s*import\s+\*\s+as\s+React\s+from\s+["'']react["''];\s*$',
        'import * as React from "react";' + "`r`n" + 'import { useRouter } from "next/navigation";',
        1
      )
    } elseif ($login -match '(?m)^\s*["'']use client["''];\s*$') {
      $login = [regex]::Replace(
        $login,
        '(?m)^\s*["'']use client["''];\s*$',
        '"use client";' + "`r`n" + 'import { useRouter } from "next/navigation";',
        1
      )
    } else {
      $login = 'import { useRouter } from "next/navigation";' + "`r`n" + $login
    }
  }
}

# 2) Ensure const router = useRouter(); exists inside PassengerLoginPage
if ($login -notmatch '\bconst\s+router\s*=\s*useRouter\(\)\s*;') {
  $login = [regex]::Replace(
    $login,
    '(?s)(export\s+default\s+function\s+PassengerLoginPage\s*\(\)\s*\{\s*)',
    '$1' + "`r`n" + '  const router = useRouter();' + "`r`n",
    1
  )
}

# 3) Replace any "Login OK" message with ASCII-safe version (don’t match broken chars)
$login = [regex]::Replace(
  $login,
  'setMsg\(\s*["''][^"'']*Login\s+OK[^"'']*["'']\s*\)\s*;',
  'setMsg("Login OK. Redirecting...");',
  1
)

# 4) Add redirect after the success message if not present
if ($login -notmatch 'router\.push\(') {
  $login = [regex]::Replace(
    $login,
    'setMsg\("Login OK\. Redirecting\.\.\."\);\s*',
    'setMsg("Login OK. Redirecting...");' + "`r`n" + '      setTimeout(() => router.push("/"), 600);' + "`r`n",
    1
  )
}

WriteText $loginPath $login
Ok "[OK] Patched login page (ASCII-safe message + redirect)"

# -------------------------
# Patch SIGNUP page
# -------------------------
$signup = ReadText $signupPath

$signup = [regex]::Replace(
  $signup,
  'setMsg\(\s*["''][^"'']*Signup[^"'']*Redirect[^"'']*["'']\s*\)\s*;',
  'setMsg("Signup successful! Redirecting to login...");',
  1
)

WriteText $signupPath $signup
Ok "[OK] Patched signup page (ASCII-safe message)"

Ok ""
Ok "[DONE] Phase 5D UI patch applied."
Info ""
Info "NEXT:"
Info "npm.cmd run build"
Info "git add -A"
Info "git commit -m `"JRIDE_PHASE5D fix passenger login/signup UI message + redirect`""
Info "git tag JRIDE_PHASE5D_LOGIN_UI_$ts"
Info "git push"
Info "git push --tags"
