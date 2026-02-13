# PATCH-JRIDE_CONTROL_CENTER_ADD_WALLET_ADJUST_LINK_V1.ps1
# Purpose: Add /admin/wallet-adjust link in Admin Control Center (navigation only)
# Safe: edits only app\admin\control-center\page.tsx

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Fail($m) { throw $m }

function Find-RepoRoot {
  $dir = (Get-Location).Path
  for ($i=0; $i -lt 12; $i++) {
    if (Test-Path (Join-Path $dir "package.json")) { return $dir }
    $p = Split-Path -Parent $dir
    if ($p -eq $dir) { break }
    $dir = $p
  }
  Fail "Could not find repo root (package.json). Run from inside the repo."
}

$root = Find-RepoRoot
Write-Host "[INFO] Repo root: $root"

$target = Join-Path $root "app\admin\control-center\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

$bak = "$target.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw

$anchor = @'
{
            title: "Wallet Reconciliation",
            desc: "Read-only reconciliation status dashboard placeholder.",
            href: "/admin/ops/wallet-reconciliation",
          },
'@

if ($txt.IndexOf($anchor) -lt 0) {
  Fail "Anchor not found. The Wallet Reconciliation block did not match exactly. Paste the current file and we will patch with your exact anchors."
}

$insertion = @'
{
            title: "Wallet Adjustments (Admin)",
            desc: "Manual driver credit/debit + vendor wallet adjustments and full settle.",
            href: "/admin/wallet-adjust",
          },
'@

# Insert new item right after Wallet Reconciliation block
$replacement = $anchor + $insertion

$txt2 = $txt.Replace($anchor, $replacement)
if ($txt2 -eq $txt) { Fail "No changes applied (unexpected)."; }

# Write back as UTF-8 (no BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt2, $utf8NoBom)

Write-Host "[OK] Patched: $target"
Write-Host ""
Write-Host "[NEXT] Build:"
Write-Host "  npm.cmd run build"
