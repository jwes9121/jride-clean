# PATCH-JRIDE_ADMIN_VENDORS_ADD_QR.ps1
# Adds QR code preview under the vendor private link buttons in app\admin\vendors\page.tsx
# ASCII-only, safe patch, creates a .bak timestamp.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

$target = "app\admin\vendors\page.tsx"
if (!(Test-Path $target)) { Fail "Missing target: $target" }

$bak = "$target.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

# 1) Ensure qrUrl helper exists (insert after vendorLink function)
if ($txt -notmatch 'function\s+qrUrl\s*\(') {
  $anchor = [regex]::Match($txt, '(?s)function\s+vendorLink\s*\(\s*vendorId:\s*string\s*\)\s*\{.*?\n\}')
  if (!$anchor.Success) { Fail "Could not find function vendorLink(vendorId: string) { ... }" }

  $insert = @'
function qrUrl(text: string) {
  // Simple remote QR generator (no deps). Treat as display only.
  // If offline or blocked, QR just won't load (link still works).
  return "https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=" + encodeURIComponent(text);
}
'@

  $txt = $txt.Substring(0, $anchor.Index + $anchor.Length) + "`r`n`r`n" + $insert + "`r`n" + $txt.Substring($anchor.Index + $anchor.Length)
  Write-Host "[OK] Inserted qrUrl() helper" -ForegroundColor Green
} else {
  Write-Host "[OK] qrUrl() already present (skipped)" -ForegroundColor Green
}

# 2) Add QR image under the existing link buttons (inside the Link <td>)
# Look for the "Open" anchor in the link cell and inject after it.
if ($txt -notmatch 'Scan to open') {
  $pattern = '(?s)(<a[^>]*>\s*Open\s*</a>)'
  $m = [regex]::Match($txt, $pattern)
  if (!$m.Success) { Fail "Could not find the 'Open' link anchor to inject QR under it." }

  $qrBlock = @'
$1
<div className="mt-2">
  <a href={link} target="_blank" rel="noreferrer" className="inline-block">
    <img
      src={qrUrl(link)}
      alt="QR"
      className="h-[84px] w-[84px] rounded border border-black/10 bg-white"
    />
  </a>
  <div className="mt-1 text-[11px] opacity-60">Scan to open</div>
</div>
'@

  $txt = [regex]::Replace($txt, $pattern, $qrBlock, 1)
  Write-Host "[OK] Injected QR block under Open link" -ForegroundColor Green
} else {
  Write-Host "[OK] QR block already present (skipped)" -ForegroundColor Green
}

# 3) Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes($txt))
Write-Host "[OK] Patched: $target (UTF-8 no BOM)" -ForegroundColor Green
