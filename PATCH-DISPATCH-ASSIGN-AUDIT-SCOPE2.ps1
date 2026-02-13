# PATCH-DISPATCH-ASSIGN-AUDIT-SCOPE2.ps1
# Fixes actor/meta scope so auditAssign works in catch()

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\api\dispatch\assign\route.ts"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# 1) Extend function-scope declarations
$rxPost = 'export\s+async\s+function\s+POST\s*\(\s*req:\s*Request\s*\)\s*\{\s*let\s+bookingCode:.*?;\s*let\s+driverId:.*?;\s*try\s*\{'
if ($t -notmatch $rxPost) {
  Fail "Could not locate POST() scope block to extend."
}

$t = [regex]::Replace(
  $t,
  $rxPost,
  'export async function POST(req: Request) {' + "`r`n" +
  '  let bookingCode: string | undefined;' + "`r`n" +
  '  let driverId: string | undefined;' + "`r`n" +
  '  let actor: string | undefined;' + "`r`n" +
  '  let meta: any;' + "`r`n" +
  '  try {',
  1
)

# 2) Change inner declarations to assignments
$t = $t.Replace(
  'const actor =',
  'actor ='
)

$t = $t.Replace(
  'const meta =',
  'meta ='
)

Set-Content -LiteralPath $f -Value $t -Encoding UTF8
Write-Host "PATCHED: actor/meta scope fixed for audit logging" -ForegroundColor Green
