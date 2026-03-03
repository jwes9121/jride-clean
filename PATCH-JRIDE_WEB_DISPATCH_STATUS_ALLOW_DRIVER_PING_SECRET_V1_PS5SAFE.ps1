param(
  [Parameter(Mandatory=$true)][string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Backup-File($path, $tag) {
  $bakDir = Join-Path $RepoRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Force -Path $bakDir | Out-Null }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ((Split-Path $path -Leaf) + ".bak.$tag.$ts")
  Copy-Item -Force $path $bak
  Write-Host "[OK] Backup: $bak"
}

# Find route.ts (supports both app/api/... and your flattened diag-pack path)
$route = Get-ChildItem -Path $RepoRoot -Recurse -File -Filter "route.ts" |
  Where-Object { $_.FullName -match "dispatch[\\\/]status[\\\/]route\.ts$" } |
  Select-Object -First 1

if (-not $route) { throw "Could not find dispatch/status/route.ts under $RepoRoot" }

$path = $route.FullName
Backup-File $path "ALLOW_DRIVER_PING_SECRET_V1"

$txt = Get-Content -Raw -LiteralPath $path

# Patch BOTH auth gates (GET and POST) by adding driver secret check
# We’ll inject:
#   const wantDriver = process.env.DRIVER_PING_SECRET || process.env.JRIDE_DRIVER_PING_SECRET
#   const gotDriver  = req.headers.get("x-driver-ping-secret")
# and allow when matches.

$patchBlock = @'
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_STATUS || "").trim() === "1";
  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret = String(req.headers.get("x-jride-admin-secret") || req.headers.get("x-admin-secret") || "").trim();

  const wantDriverSecret = String(process.env.DRIVER_PING_SECRET || process.env.JRIDE_DRIVER_PING_SECRET || "").trim();
  const gotDriverSecret = String(req.headers.get("x-driver-ping-secret") || "").trim();

  let actorUserId: string | null = null;

  if (
    !allowUnauth &&
    !(wantSecret && gotSecret && gotSecret === wantSecret) &&
    !(wantDriverSecret && gotDriverSecret && gotDriverSecret === wantDriverSecret)
  ) {
    try {
      const { data } = await supabase.auth.getUser();
      actorUserId = data?.user?.id ?? null;
    } catch {
      actorUserId = null;
    }
    if (!actorUserId) {
      return jsonErr("UNAUTHORIZED", "Not authenticated", 401);
    }
  }
'@

# Replace the POST gate section
$txt = $txt -replace [regex]::Escape('  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_STATUS || "").trim() === "1";') + '.*?return jsonErr\("UNAUTHORIZED", "Not authenticated", 401\);\s*\}\s*\}', $patchBlock

# Replace the GET gate section (same pattern)
$txt = $txt -replace [regex]::Escape('  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_STATUS || "").trim() === "1";') + '.*?return jsonErr\("UNAUTHORIZED", "Not authenticated", 401\);\s*\}\s*\}', $patchBlock

Set-Content -NoNewline -Encoding UTF8 -LiteralPath $path -Value $txt
Write-Host "[OK] Patched: $path"
Write-Host "[DONE] Web patched. Next: set env + deploy."