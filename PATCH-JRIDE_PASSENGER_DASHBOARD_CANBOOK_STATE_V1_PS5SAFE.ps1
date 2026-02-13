param(
  [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$path, [string]$repoRoot) {
  $bakDir = Join-Path $repoRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($path)
  $bak = Join-Path $bakDir ("{0}.bak.{1}" -f $name, $ts)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  return $bak
}

function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m) { Write-Host $m -ForegroundColor Green }

$target = Join-Path $RepoRoot "app\passenger\page.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing target: app\passenger\page.tsx" }

$src = Get-Content -LiteralPath $target -Raw

# 1) Replace the two session-based setters (must exist)
$needle1 = "setVerified(!!j?.user?.verified);"
$needle2 = "setNightAllowed(!!j?.user?.night_allowed);"

if ($src -notmatch [regex]::Escape($needle1)) { Fail "[FAIL] Anchor not found: setVerified(!!j?.user?.verified);" }
if ($src -notmatch [regex]::Escape($needle2)) { Fail "[FAIL] Anchor not found: setNightAllowed(!!j?.user?.night_allowed);" }

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

$replacement = @"
        // JRIDE: derive verified/nightGate from can-book (source of truth)
        try {
          const cr = await fetch("/api/public/passenger/can-book", { cache: "no-store" });
          const cj = await cr.json();
          setVerified(!!cj?.verified);
          // "night_allowed" means "night booking allowed now" (i.e., gate OFF or verified)
          setNightAllowed(!cj?.nightGate || !!cj?.verified);
        } catch {
          // fallback (do not hard-fail dashboard)
          setVerified(false);
          setNightAllowed(false);
        }
"@

# Replace the two lines as a block (keep surrounding indentation)
$src2 = $src.Replace($needle1 + "`r`n        " + $needle2, $replacement.TrimEnd())

# If CRLF shape differs, fallback to independent replacements (still safe)
if ($src2 -eq $src) {
  $src2 = $src2.Replace($needle1, $replacement.TrimEnd())
  $src2 = $src2.Replace($needle2, "")
}

# 2) Update the card title logic:
# from: verified ? "Account verified" : "Verification required"
# to:   verified ? "Account verified" : (nightAllowed ? "Verification recommended" : "Verification required (night booking)")
$oldTitle = '{verified ? "Account verified" : "Verification required"}'
$newTitle = '{verified ? "Account verified" : (nightAllowed ? "Verification recommended" : "Verification required (night booking)")}'

if ($src2 -notmatch [regex]::Escape($oldTitle)) {
  Fail "[FAIL] Could not find title expression anchor in the dashboard card."
}
$src2 = $src2.Replace($oldTitle, $newTitle)

# 3) Tweak the default helper text slightly (optional but requested policy)
$oldHint = 'Verify to unlock night booking and free ride promo.'
$newHint = 'Verification unlocks free ride promo. Night booking (8PM–5AM) requires verification.'
$src2 = $src2.Replace($oldHint, $newHint)

WriteUtf8NoBom $target $src2
Ok "[OK] Patched passenger dashboard to use can-book as source of truth"
Ok "[OK] Wrote UTF-8 (no BOM)"
Ok "[DONE] PATCH-JRIDE_PASSENGER_DASHBOARD_CANBOOK_STATE_V1_PS5SAFE"
