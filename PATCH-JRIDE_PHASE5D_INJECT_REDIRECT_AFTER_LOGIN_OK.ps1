$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

if (!(Test-Path ".\package.json")) { Fail "Run from repo root (package.json missing)." }
if (!(Test-Path ".\app\passenger-login\page.tsx")) { Fail "Missing app\passenger-login\page.tsx" }

$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$path = ".\app\passenger-login\page.tsx"

function ReadText($p){ [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }
function WriteText($p,$t){ [IO.File]::WriteAllText($p, $t, [Text.Encoding]::UTF8) }

Copy-Item $path "$path.bak.$ts" -Force
Ok "[OK] Backup: $path.bak.$ts"

$txt = ReadText $path

# If we already injected, stop (idempotent)
if ($txt -match 'window\.location\.href\s*=\s*["'']\/passenger["'']') {
  Ok "[OK] Redirect already present. No changes."
  exit 0
}

# 1) Normalize any mojibake success message to ASCII (safe)
$txt2 = [regex]::Replace(
  $txt,
  'setMsg\(\s*["''][^"'']*Login\s+OK[^"'']*["'']\s*\)\s*;',
  'setMsg("Login OK. Redirecting...");',
  1
)

# 2) Inject redirect immediately after the Login OK message
$needle = 'setMsg("Login OK. Redirecting...");'
if ($txt2 -notmatch [regex]::Escape($needle)) {
  # fallback: match ANY setMsg(...Login OK...) without relying on mojibake
  $txt2 = [regex]::Replace(
    $txt2,
    'setMsg\(\s*["''][^"'']*Login\s+OK[^"'']*["'']\s*\)\s*;',
    'setMsg("Login OK. Redirecting...");',
    1
  )
}

if ($txt2 -notmatch [regex]::Escape($needle)) {
  Fail "Could not find a Login OK setMsg(...) success message to patch. Paste the success block from passenger-login/page.tsx."
}

# Inject only once
$inject = $needle + "`r`n" + '      setTimeout(() => { window.location.href = "/passenger"; }, 600);'

# If there is already any redirect near the message, replace it; else just insert
if ($txt2 -match 'Login OK\. Redirecting\.\.\."?\);\s*(?:setTimeout\([^\)]*\);|router\.(?:push|replace)\([^\)]*\);|window\.location\.[^;]+;|location\.(?:assign|replace)\([^\)]*\);)') {
  $txt2 = [regex]::Replace(
    $txt2,
    'setMsg\("Login OK\. Redirecting\.\.\."\);\s*(?:setTimeout\([^\)]*\);|router\.(?:push|replace)\([^\)]*\);|window\.location\.[^;]+;|location\.(?:assign|replace)\([^\)]*\);)',
    $inject,
    1
  )
} else {
  $txt2 = $txt2.Replace($needle, $inject)
}

WriteText $path $txt2
Ok "[OK] Injected redirect to /passenger after Login OK"

Info "NEXT:"
Info "npm.cmd run build"
Info 'git add -A'
Info 'git commit -m "JRIDE_PHASE5D passenger login redirect to /passenger"'
Info "git tag JRIDE_PHASE5D_PASSENGER_REDIRECT_$ts"
Info "git push"
Info "git push --tags"
