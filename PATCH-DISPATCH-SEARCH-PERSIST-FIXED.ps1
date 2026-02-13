# PATCH-DISPATCH-SEARCH-PERSIST-FIXED.ps1
# Persist Search V2 + quick filters to localStorage (Dispatch-only)
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

# Guard: don't double-apply
if ($txt -match "JRIDE_UI_SEARCH_PERSIST_START") {
  Warn "Marker already present. No changes made."
  exit 0
}

# Ensure required state exists (Search V2)
$need = @(
  "const [searchQ, setSearchQ]",
  "const [qBooking, setQBooking]",
  "const [qPhone, setQPhone]",
  "const [qStatus, setQStatus]",
  "const [qTown, setQTown]"
)
foreach ($n in $need) {
  if ($txt -notmatch [regex]::Escape($n)) { Fail "Missing expected Search V2 state line: $n" }
}

# Reliable anchor: insert right after the Search state marker end
$anchor = "/* JRIDE_UI_SEARCH_END */"
if ($txt -notmatch [regex]::Escape($anchor)) {
  Fail "Could not find anchor marker: $anchor"
}

$persist = @"

  /* JRIDE_UI_SEARCH_PERSIST_START */
  // Persist Search V2 + quick filters (localStorage only; hooks-safe)
  const LS_KEY_SEARCH_V2 = "JRIDE_DISPATCH_SEARCH_V2";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY_SEARCH_V2);
      if (!raw) return;
      const j = JSON.parse(raw || "{}");

      if (typeof j.searchQ === "string") setSearchQ(j.searchQ);
      if (typeof j.qBooking === "string") setQBooking(j.qBooking);
      if (typeof j.qPhone === "string") setQPhone(j.qPhone);
      if (typeof j.qStatus === "string") setQStatus(j.qStatus);
      if (typeof j.qTown === "string") setQTown(j.qTown);
    } catch {}
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const payload = {
        v: 1,
        searchQ,
        qBooking,
        qPhone,
        qStatus,
        qTown,
      };
      localStorage.setItem(LS_KEY_SEARCH_V2, JSON.stringify(payload));
    } catch {}
  }, [searchQ, qBooking, qPhone, qStatus, qTown]);
  /* JRIDE_UI_SEARCH_PERSIST_END */
"@

# Insert immediately after the marker line (first occurrence only)
$txt2 = $txt.Replace($anchor, ($anchor + $persist))
if ($txt2 -eq $txt) { Fail "No change produced (unexpected)." }

Set-Content -Path $target -Value $txt2 -Encoding UTF8
Ok "Patched: $target"

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "1) npm run build" -ForegroundColor Cyan
Write-Host "2) npm run dev (set filters, reload page, confirm persistence)" -ForegroundColor Cyan
Write-Host "3) git diff (confirm marker block + minimal change)" -ForegroundColor Cyan
