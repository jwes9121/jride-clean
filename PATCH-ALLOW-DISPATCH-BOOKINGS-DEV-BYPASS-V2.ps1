$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\api\dispatch\bookings\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

# Backup
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup created: $bak" -ForegroundColor Green

$txt = Get-Content -Raw -Encoding UTF8 $target

# Quick sanity: must be a Next.js route with POST
if ($txt -notmatch "export\s+async\s+function\s+POST\s*\(") {
  Fail "Did not find 'export async function POST(' in $target. Paste the first ~120 lines."
}

# 1) Insert dev-bypass helper ONCE after imports (safe, no UI changes)
$marker = "/* JRIDE_DEV_BYPASS_DISPATCH_BOOKINGS */"
if ($txt -notmatch [regex]::Escape($marker)) {
  $inject = @"
$marker
function jrideDevBypass(req: any): boolean {
  try {
    // Only allow bypass in non-production AND only for localhost requests
    if (process.env.NODE_ENV === "production") return false;
    const host = String(req?.headers?.get?.("host") || "");
    if (!host.includes("localhost") && !host.includes("127.0.0.1")) return false;

    // Optional header toggle (not required)
    const h = String(req?.headers?.get?.("x-jride-dev-bypass") || "");
    if (h === "1") return true;

    // Default: localhost in dev = bypass enabled
    return true;
  } catch {
    return false;
  }
}
"@

  # place after last import line
  $lines = $txt -split "`r?`n"
  $lastImportIdx = -1
  for ($i=0; $i -lt $lines.Count; $i++){
    if ($lines[$i] -match "^\s*import\s+") { $lastImportIdx = $i }
  }
  if ($lastImportIdx -lt 0) { Fail "No import lines found to anchor injection." }

  $before = $lines[0..$lastImportIdx] -join "`n"
  $after  = $lines[($lastImportIdx+1)..($lines.Count-1)] -join "`n"
  $txt = $before + "`n`n" + $inject + "`n" + $after
  Write-Host "[OK] Inserted dev-bypass helper" -ForegroundColor Green
} else {
  Write-Host "[OK] Dev-bypass helper already present" -ForegroundColor Green
}

# 2) Inside POST(): add a flag early (right after body parsing is ideal; but we do it at function top)
if ($txt -notmatch "const\s+__JRIDE_DEV_BYPASS__\s*=\s*jrideDevBypass\(") {
  $rxPostOpen = '(export\s+async\s+function\s+POST\s*\(\s*req\s*:\s*NextRequest\s*\)\s*\{\s*)'
  if ($txt -notmatch $rxPostOpen) { Fail "Could not locate POST(req: NextRequest) opening brace." }

  $txt = [regex]::Replace(
    $txt,
    $rxPostOpen,
    ('$1' + "`n  const __JRIDE_DEV_BYPASS__ = jrideDevBypass(req);`n"),
    1
  )
  Write-Host "[OK] Added __JRIDE_DEV_BYPASS__ flag inside POST()" -ForegroundColor Green
} else {
  Write-Host "[OK] __JRIDE_DEV_BYPASS__ already present" -ForegroundColor Green
}

# 3) Guard common auth/forbidden returns without assuming exact text.
#    We wrap any explicit 401/403 JSON returns so they only trigger when NOT dev bypass.
#    Patterns handled:
#      - NextResponse.json(..., { status: 403 })
#      - NextResponse.json(..., {status:401})
#      - new NextResponse(..., { status: 403 })
$did = $false

# Helper: wrap "return NextResponse.json(... { status: 403/401 } )" with if (!bypass) ...
$patterns = @(
  '(?ms)^\s*return\s+NextResponse\.json\((?<payload>.*?),\s*\{\s*status\s*:\s*(?<code>401|403)\s*\}\s*\)\s*;\s*$',
  '(?ms)^\s*return\s+new\s+NextResponse\((?<payload>.*?),\s*\{\s*status\s*:\s*(?<code>401|403)\s*\}\s*\)\s*;\s*$'
)

foreach ($p in $patterns) {
  $m = [regex]::Matches($txt, $p)
  if ($m.Count -gt 0) {
    $txt = [regex]::Replace($txt, $p, {
      param($mm)
      $code = $mm.Groups["code"].Value
      $payload = $mm.Groups["payload"].Value.Trim()
      $script:did = $true
      return "  if (!__JRIDE_DEV_BYPASS__) { return NextResponse.json($payload, { status: $code }); }"
    })
  }
}

# If no explicit 401/403 found, do a softer bypass:
# try to detect a "require auth" block by keywords and short-circuit it.
if (-not $did) {
  # Common keywords in your repo: dispatcher, role, user_roles, forbidden, unauthorized
  if ($txt -match "(forbidden|unauthorized|user_roles|dispatcher|requireAuth|requireDispatcher|isDispatcher)") {
    # Insert a comment so we know patch ran; do NOT break logic
    if ($txt -notmatch "JRIDE_DEV_BYPASS_NOTE") {
      $txt = $txt -replace '(const __JRIDE_DEV_BYPASS__ = jrideDevBypass\(req\);)',
        ('$1' + "`n  // JRIDE_DEV_BYPASS_NOTE: localhost dev bypass enabled; auth-gate should not block create in dev.`n")
      Write-Host "[WARN] No explicit 401/403 return found to wrap. Added note only." -ForegroundColor Yellow
      Write-Host "       If /dispatch still shows Forbidden, paste first 140 lines of $target and I’ll patch the exact gate." -ForegroundColor Yellow
    }
  } else {
    Write-Host "[WARN] No 401/403 patterns AND no auth keywords found. File may already be open in dev." -ForegroundColor Yellow
  }
} else {
  Write-Host "[OK] Wrapped explicit 401/403 returns with dev-bypass" -ForegroundColor Green
}

# Write back
Set-Content -Path $target -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $target" -ForegroundColor Green

# Sanity: ensure file still has POST and bypass flag
$check = Get-Content -Raw -Encoding UTF8 $target
if ($check -notmatch "const __JRIDE_DEV_BYPASS__ = jrideDevBypass\(req\);") { Fail "Sanity failed: bypass flag missing after write." }
if ($check -notmatch "export\s+async\s+function\s+POST") { Fail "Sanity failed: POST missing after write." }

Write-Host "`nNEXT:" -ForegroundColor Cyan
Write-Host "1) Restart dev server (Ctrl+C then npm run dev)" -ForegroundColor Cyan
Write-Host "2) Go to http://localhost:3000/dispatch and Create an Express / OTC takeout booking." -ForegroundColor Cyan
