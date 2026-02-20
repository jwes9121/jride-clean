# PATCH-JRIDE_DISPATCH_STATUS_SECRET_GATE_CLEAN_V1_PS5SAFE.ps1
param(
  [Parameter(Mandatory=$true)][string]$ProjRoot,
  [string]$Tag = "JRIDE_LIFECYCLE_LOGGING_LOCKDOWN_GREEN_V1"
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$repo = Resolve-Path $ProjRoot
Set-Location $repo

$target = Join-Path $repo "app\api\dispatch\status\route.ts"
if (!(Test-Path $target)) { Fail "[FAIL] Missing: $target" }

# Ensure tag exists
$tags = git tag
if ($tags -notcontains $Tag) { Fail "[FAIL] Tag not found: $Tag" }

# Backup current
$bakDir = Join-Path $repo "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.bak.DISPATCH_SECRET_CLEAN_V1.{0}.{1}" -f $Tag, $stamp)
Copy-Item $target $bak -Force
Ok "[OK] Backup: $bak"

# Restore known-good from tag
Info "[..] Restoring route.ts from tag $Tag"
git checkout $Tag -- "app/api/dispatch/status/route.ts" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "[FAIL] git checkout from tag failed" }
Ok "[OK] Restored from tag"

# Read file (force text)
$raw = Get-Content -LiteralPath $target -Raw

# Remove any existing gate block (if already present in the tagged version or later edits)
$raw = [regex]::Replace(
  $raw,
  "(?s)\r?\n\s*//\s*JRIDE_ADMIN_SECRET_GATE_BEGIN.*?//\s*JRIDE_ADMIN_SECRET_GATE_END\s*\r?\n",
  "`r`n"
)

# Find insertion point: right after supabase init INSIDE POST handler.
# We’ll anchor on the first occurrence of:  const supabase = ...
$pattern = "(?m)^\s*const\s+supabase\s*=\s*.*?;\s*$"
$m = [regex]::Match($raw, $pattern)
if (!$m.Success) {
  Fail "[FAIL] Could not find supabase init anchor: 'const supabase = ...;'"
}

$gate = @"
  // JRIDE_ADMIN_SECRET_GATE_BEGIN
  // Allow unauth only when explicitly enabled (dev/testing)
  const __jride_allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_STATUS || "").trim() === "1";
  const __jride_wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const __jride_gotSecret = String(req.headers.get("x-jride-admin-secret") || req.headers.get("x-admin-secret") || "").trim();
  const __jride_secretOk = Boolean(__jride_wantSecret) && Boolean(__jride_gotSecret) && __jride_gotSecret === __jride_wantSecret;

  if (!__jride_allowUnauth && !__jride_secretOk) {
    try {
      const { data } = await supabase.auth.getUser();
      const __jride_uid = data?.user?.id ?? null;
      if (!__jride_uid) return jsonErr("UNAUTHORIZED", "Not authenticated", 401);
    } catch {
      return jsonErr("UNAUTHORIZED", "Not authenticated", 401);
    }
  }
  // JRIDE_ADMIN_SECRET_GATE_END
"@

$insertAt = $m.Index + $m.Length
$raw2 = $raw.Substring(0, $insertAt) + "`r`n`r`n" + $gate + $raw.Substring($insertAt)

# Write UTF-8 (NO BOM) to avoid “garbage header” ever happening again
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $raw2, $utf8NoBom)
Ok "[OK] Injected single secret gate block (BEGIN/END) + saved UTF-8 no BOM"

Info "[..] Done. Now run: npm.cmd run build"
