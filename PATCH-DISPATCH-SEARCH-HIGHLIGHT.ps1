# PATCH-DISPATCH-SEARCH-HIGHLIGHT.ps1
# Visual highlight for Search V2 matches (Dispatch-only)
# Touches ONLY: app\dispatch\page.tsx
# Reversible via marker block.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$target = "app\dispatch\page.tsx"
if (-not (Test-Path $target)) { Fail "Missing file: $target (run from repo root)" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item -Force $target $bak
Ok "Backup: $bak"

$txt = Get-Content $target -Raw

# Guard
if ($txt -match "JRIDE_UI_SEARCH_HIGHLIGHT_START") {
  Warn "Highlight block already present. No changes made."
  exit 0
}

# Insert helper near other pure helpers (after normStatus)
$anchor = "function normStatus"
if ($txt -notmatch $anchor) { Fail "Anchor not found: normStatus" }

$helper = @"

  /* JRIDE_UI_SEARCH_HIGHLIGHT_START */
  function highlightText(text: any, needle: string) {
    const t = String(text ?? "");
    const n = String(needle ?? "").trim();
    if (!n) return t;

    const idx = t.toLowerCase().indexOf(n.toLowerCase());
    if (idx < 0) return t;

    return (
      <>
        {t.slice(0, idx)}
        <mark className="rounded bg-yellow-200 px-0.5">
          {t.slice(idx, idx + n.length)}
        </mark>
        {t.slice(idx + n.length)}
      </>
    );
  }
  /* JRIDE_UI_SEARCH_HIGHLIGHT_END */
"@

$txt2 = $txt.Replace("function normStatus", ($helper + "`nfunction normStatus"))
if ($txt2 -eq $txt) { Fail "Failed to inject highlight helper." }

Set-Content -Path $target -Value $txt2 -Encoding UTF8
Ok "Inserted highlight helper."

# Apply highlight in Bookings table (booking code + status)
$txt = Get-Content $target -Raw

$replacements = @{
  '{code}' = '{highlightText(code, qBooking || searchQ)}'
  '{s || "-"}' = '{highlightText(s || "-", qStatus || searchQ)}'
}

foreach ($k in $replacements.Keys) {
  if ($txt -match [regex]::Escape($k)) {
    $txt = $txt.Replace($k, $replacements[$k])
    Ok "Applied highlight replacement: $k"
  }
}

Set-Content -Path $target -Value $txt -Encoding UTF8
Ok "Patched highlights into table."

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "1) npm run build" -ForegroundColor Cyan
Write-Host "2) npm run dev (verify yellow highlights on matches)" -ForegroundColor Cyan
Write-Host "3) git diff (confirm marker block only)" -ForegroundColor Cyan
