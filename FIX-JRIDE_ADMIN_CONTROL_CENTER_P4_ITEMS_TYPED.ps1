# FIX-JRIDE_ADMIN_CONTROL_CENTER_P4_ITEMS_TYPED.ps1
# Fix: Remove accidental empty {} item in sections items array and insert PAX Mismatches item safely.
# UI-only. UTF-8 no BOM.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\control-center\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw -Encoding utf8
$orig = $txt

# 1) Remove any empty object items accidentally injected in arrays: ", {},"
# Handle a few formatting variants.
$txt = [regex]::Replace($txt, ",\s*\{\s*\}\s*,", ",")
$txt = [regex]::Replace($txt, "\[\s*\{\s*\}\s*,", "[")
$txt = [regex]::Replace($txt, ",\s*\{\s*\}\s*\]", "]")

# 2) Ensure PAX Mismatches item exists exactly once, inserted after Incidents item.
$needleHref = 'href: "/admin/ops/pax-mismatches",'
if ($txt -notmatch [regex]::Escape($needleHref)) {
  $incidentsAnchor = @'
            title: "Incidents",
            desc: "Ops and compliance incident reports.",
            href: "/admin/ops/incidents",
          },
'@

  if ($txt.IndexOf($incidentsAnchor) -lt 0) {
    Fail "Anchor not found for Incidents item. Paste the 'items' block around Ops section if this fails."
  }

  $paxItem = @'
            title: "PAX Mismatches",
            desc: "Read-only list of driver-reported passenger count mismatches.",
            href: "/admin/ops/pax-mismatches",
          },
'@

  $txt = $txt.Replace($incidentsAnchor, ($incidentsAnchor + $paxItem))
  Write-Host "[OK] Inserted PAX Mismatches item after Incidents"
} else {
  # If present, keep it but still ensure no blank objects remain.
  Write-Host "[OK] PAX Mismatches item already present (skip insert)"
}

if ($txt -eq $orig) { Fail "No changes applied (unexpected). If build still fails, paste the Ops items block." }

Set-Content -Path $target -Value $txt -Encoding utf8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "Now run:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Suggested commit/tag:"
Write-Host "  fix(admin-control-center): remove empty item and type-safe pax mismatches link"
Write-Host "  JRIDE_ADMIN_PAX_MISMATCHES_P4_FIX_GREEN"
