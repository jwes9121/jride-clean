# FIX-JRIDE_PASSENGER_LOGIN_ONSUBMIT_REWRITE_V2.ps1
# Hard-rewrite PassengerLoginPage onSubmit() block to use NextAuth signIn("passenger-credentials")
# Safe backup. UTF-8 no BOM.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Backup($p){
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  Copy-Item $p "$p.bak.$ts" -Force
  Write-Host "[OK] Backup: $p.bak.$ts"
}

$root = (Get-Location).Path
$f = Join-Path $root "app\passenger-login\page.tsx"
if (!(Test-Path $f)) { Fail "Missing file: $f" }

Backup $f
$txt = Get-Content $f -Raw

# Ensure signIn import exists
if ($txt -notmatch 'from "next-auth/react"') {
  if ($txt -match 'import\s+\{\s*useRouter\s*\}\s+from\s+"next/navigation";') {
    $txt = [regex]::Replace(
      $txt,
      'import\s+\{\s*useRouter\s*\}\s+from\s+"next/navigation";',
      'import { useRouter } from "next/navigation";' + "`n" + 'import { signIn } from "next-auth/react";',
      1
    )
    Write-Host "[OK] Added next-auth signIn import."
  } else {
    Fail "Could not find useRouter import anchor."
  }
} else {
  Write-Host "[SKIP] signIn import already present."
}

# Replace the entire onSubmit block up to just before 'return ('
$pattern = '(?s)async\s+function\s+onSubmit\s*\(\s*e\s*:\s*React\.FormEvent\s*\)\s*\{.*?\n\s*\}\s*\n\s*\n\s*return\s*\('
if (-not [regex]::IsMatch($txt, $pattern)) {
  Fail "Could not find the onSubmit block anchor (async function onSubmit ... return(). Paste page.tsx if it changed."
}

$replacement = @'
async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      await signIn("passenger-credentials", {
        phone,
        password,
        callbackUrl: "/passenger",
      });
    } catch (err: any) {
      setMsg(err?.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
'@

$txt = [regex]::Replace($txt, $pattern, $replacement, 1)

# Write back UTF-8 no BOM
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($f, $txt, $enc)

Write-Host "[OK] Rewrote onSubmit() cleanly to NextAuth Credentials."
Write-Host "[OK] File: $f"
