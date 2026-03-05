param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

Write-Host "== PATCH JRIDE: Dispatch STATUS allow driver secret (V1.1 / PS5-safe) =="

$target = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path -LiteralPath $target)) { throw "Not found: $target" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("route.ts.bak.DISPATCH_STATUS_ALLOW_DRIVER_SECRET_V1_1." + $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8
$orig = $content
$changed = $false

# 1) Inject allowDispatchStatus(req) helper if missing
if ($content -notmatch "function\s+allowDispatchStatus\s*\(") {
  # Find end of import block (last line starting with import)
  $lines = $content -split "`n", 0, "SimpleMatch"
  $lastImportIdx = -1
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].TrimStart().StartsWith("import ")) { $lastImportIdx = $i }
  }
  if ($lastImportIdx -lt 0) { throw "No import block found. File shape unexpected." }

  $helper = @'
/* JRIDE_DISPATCH_STATUS_AUTH_HELPER_V1_1 */
function allowDispatchStatus(req: Request) {
  // DEBUG bypass (set to "1" only while testing)
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_STATUS || "").trim() === "1";

  // Admin secret (admin tools)
  const adminWant = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const adminGot = String(
    req.headers.get("x-jride-admin-secret") ||
    req.headers.get("x-admin-secret") ||
    ""
  ).trim();
  const adminOk = Boolean(adminWant) && Boolean(adminGot) && adminGot === adminWant;

  // Driver secret (driver app)
  const driverWant = String(process.env.JRIDE_DRIVER_SECRET || "").trim();
  const driverGot = String(
    req.headers.get("x-jride-driver-secret") ||
    req.headers.get("x-driver-secret") ||
    ""
  ).trim();
  const driverOk = Boolean(driverWant) && Boolean(driverGot) && driverGot === driverWant;

  return allowUnauth || adminOk || driverOk;
}
/* JRIDE_DISPATCH_STATUS_AUTH_HELPER_V1_1_END */

'@

  # Insert helper after last import line
  $before = ($lines[0..$lastImportIdx] -join "`n")
  $after  = ""
  if ($lastImportIdx+1 -lt $lines.Count) { $after = ($lines[($lastImportIdx+1)..($lines.Count-1)] -join "`n") }

  $content = $before + "`n`n" + $helper + $after
  $changed = $true
  Write-Host "[OK] Inserted allowDispatchStatus(req) helper."
} else {
  Write-Host "[OK] allowDispatchStatus(req) already present."
}

# 2) Insert auth gate at start of POST handler (immediately after opening brace)
$rePost = [regex]::new("export\s+async\s+function\s+POST\s*\([^)]*\)\s*\{", [System.Text.RegularExpressions.RegexOptions]::Singleline)
$mPost = $rePost.Match($content)
if (-not $mPost.Success) { throw "POST handler not found (export async function POST...). File shape unexpected." }

# Only insert once
if ($content -notmatch "JRIDE_DISPATCH_STATUS_AUTH_GUARD_V1_1") {
  $insertAt = $mPost.Index + $mPost.Length
  $guard = @'

  /* JRIDE_DISPATCH_STATUS_AUTH_GUARD_V1_1 */
  if (!allowDispatchStatus(req)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  /* JRIDE_DISPATCH_STATUS_AUTH_GUARD_V1_1_END */

'@
  $content = $content.Insert($insertAt, $guard)
  $changed = $true
  Write-Host "[OK] Inserted auth guard into POST()."
} else {
  Write-Host "[OK] Auth guard already present."
}

# 3) Insert ping handler after req.json() (so you can test without booking ids)
if ($content -notmatch "JRIDE_DISPATCH_STATUS_PING_V1_1") {
  $reJson = [regex]::new("await\s+req\.json\s*\(\s*\)", [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $mJson = $reJson.Match($content)
  if ($mJson.Success) {
    # Insert right after the semicolon ending the statement containing await req.json()
    $semi = $content.IndexOf(";", $mJson.Index)
    if ($semi -gt 0) {
      $ping = @'

  /* JRIDE_DISPATCH_STATUS_PING_V1_1 */
  // Allows health-check from tools without needing a booking id
  if (body && body.ping === 1) {
    return NextResponse.json({ ok: true, pong: true }, { status: 200 });
  }
  /* JRIDE_DISPATCH_STATUS_PING_V1_1_END */

'@
      $content = $content.Insert($semi + 1, $ping)
      $changed = $true
      Write-Host "[OK] Inserted ping handler after req.json()."
    } else {
      Write-Host "[WARN] Could not locate ';' after await req.json() to insert ping."
    }
  } else {
    Write-Host "[WARN] Could not find await req.json() to insert ping."
  }
} else {
  Write-Host "[OK] Ping handler already present."
}

if (-not $changed -or $content -eq $orig) { throw "No changes applied. Aborting." }

# Write UTF-8 without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
Write-Host "[OK] Wrote: $target"

Write-Host ""
Write-Host "NEXT:"
Write-Host "1) Set env JRIDE_DRIVER_SECRET on Vercel"
Write-Host "2) (Optional dev) JRIDE_ALLOW_UNAUTH_DISPATCH_STATUS=1 while testing"
Write-Host "3) npm run build"