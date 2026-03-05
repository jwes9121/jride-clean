param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

Write-Host "== PATCH JRIDE: dispatch/status query ping early-return (V1 / PS5-safe) =="

$target = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path -LiteralPath $target)) { throw "Not found: $target" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$bak = Join-Path $bakDir ("route.ts.bak.DISPATCH_STATUS_QUERY_PING_V1." + $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8
$orig = $content

$rePost = [regex]::new("export\s+async\s+function\s+POST\s*\(([^)]*)\)\s*\{", "Singleline")
$mPost = $rePost.Match($content)
if (-not $mPost.Success) { throw "POST handler not found." }

if ($content -notmatch "JRIDE_DISPATCH_STATUS_QUERY_PING_V1") {
  $insertAt = $mPost.Index + $mPost.Length
  $block = @'

  /* JRIDE_DISPATCH_STATUS_QUERY_PING_V1 */
  // Health check that bypasses body parsing/validation
  try {
    const u = new URL(req.url);
    if (u.searchParams.get("ping") === "1") {
      return NextResponse.json({ ok: true, pong: true }, { status: 200 });
    }
  } catch {}
  /* JRIDE_DISPATCH_STATUS_QUERY_PING_V1_END */

'@
  $content = $content.Insert($insertAt, $block)
  Write-Host "[OK] Inserted query ping early-return."
} else {
  Write-Host "[OK] Query ping already present."
}

if ($content -eq $orig) { throw "No changes applied." }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
Write-Host "[OK] Wrote: $target"