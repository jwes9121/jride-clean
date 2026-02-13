$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

if (!(Test-Path ".\package.json")) { Fail "Run this from your Next.js repo root (where package.json exists)." }

$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$apiLogin = "app\api\public\auth\login\route.ts"

if (!(Test-Path $apiLogin)) { Fail "Login route not found: $apiLogin" }

$bak = "$apiLogin.bak.$ts"
Copy-Item $apiLogin $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content $apiLogin -Raw

# Pattern: first return NextResponse.json({ ok: true ... })
$pattern = 'return\s+NextResponse\.json\s*\(\s*\{\s*ok\s*:\s*true[\s\S]*?\}\s*\)\s*;?'

$rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)

if (-not $rx.IsMatch($txt)) {
  Warn "[WARN] Could not detect the ok:true JSON return block in login route. No changes made."
  exit 0
}

$replacement = @'
return NextResponse.json({
      ok: true,
      user_id: data?.user?.id ?? null,
      phone,
      verified: (data?.user?.user_metadata as any)?.verified ?? null,
      night_allowed: (data?.user?.user_metadata as any)?.night_allowed ?? null,
      isNightPH: (() => {
        try {
          const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12:false, hour:"2-digit" });
          const hh = parseInt(dtf.format(new Date()) || "0", 10);
          return (hh >= 20) || (hh < 5);
        } catch {
          return null;
        }
      })(),
      nightRestrictedNow: (() => {
        try {
          const md: any = (data?.user?.user_metadata as any) || {};
          const v = md?.verified === true || ["1","true","yes","y","on"].includes(String(md?.verified ?? "").trim().toLowerCase());
          const na = md?.night_allowed === true || ["1","true","yes","y","on"].includes(String(md?.night_allowed ?? "").trim().toLowerCase()) || v;
          const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12:false, hour:"2-digit" });
          const hh = parseInt(dtf.format(new Date()) || "0", 10);
          const night = (hh >= 20) || (hh < 5);
          return night && !na;
        } catch {
          return null;
        }
      })(),
    });
'@

# Replace only first match
$txt2 = $rx.Replace($txt, $replacement, 1)

Set-Content -LiteralPath $apiLogin -Value $txt2 -Encoding UTF8
Ok "[OK] Patched: $apiLogin (regex fix applied)"

Ok ""
Ok "[DONE] Phase5C login patch completed."
Info ""
Info "NEXT:"
Info "npm.cmd run build"
Info "git add -A"
Info "git commit -m `"JRIDE_PHASE5C night gate login flags`""
Info "git tag JRIDE_PHASE5C_LOGINFLAGS_$ts"
Info "git push"
Info "git push --tags"
