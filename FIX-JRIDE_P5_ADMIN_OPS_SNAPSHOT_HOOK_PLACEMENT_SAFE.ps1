# FIX-JRIDE_P5_ADMIN_OPS_SNAPSHOT_HOOK_PLACEMENT_SAFE.ps1
# Fix: Move P5 useEffect to top-level (outside useMemo callbacks) to satisfy Rules of Hooks.
# - Removes the misplaced P5 useEffect block by marker
# - Reinserts it before `const sections: Section[] = useMemo`
# UTF-8 no BOM, ASCII only, fail-fast.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

function WriteUtf8NoBom($path, $content){
  $dir = Split-Path -Parent $path
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllBytes($path, [System.Text.Encoding]::UTF8.GetBytes($content))
}

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\control-center\page.tsx"
if (!(Test-Path $target)) { Fail "Target not found: $target" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$stamp"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content $target -Raw -Encoding utf8
$orig = $txt

# 1) Remove misplaced P5 useEffect block (marker-based)
$marker = "// P5: load PAX mismatch count (matches = false)"
$mi = $txt.IndexOf($marker)
if ($mi -lt 0) { Fail "Could not find P5 marker in file: $marker" }

# Remove from marker line through the end of that useEffect call
# We expect it ends with '}, []);'
$endNeedle = "}, []);"
$ei = $txt.IndexOf($endNeedle, $mi)
if ($ei -lt 0) { Fail "Could not find end of P5 useEffect block (needle: $endNeedle)" }
$endPos = $ei + $endNeedle.Length

# Expand to include trailing newline(s)
while ($endPos -lt $txt.Length -and ($txt[$endPos] -eq "`r" -or $txt[$endPos] -eq "`n")) { $endPos++ }

$txt = $txt.Substring(0, $mi) + $txt.Substring($endPos)
Write-Host "[OK] Removed misplaced P5 useEffect block"

# 2) Insert correct P5 useEffect at top-level: before sections useMemo
$anchor1 = "const sections: Section[] = useMemo"
$anchor2 = "const sections = useMemo"

$ai = $txt.IndexOf($anchor1)
if ($ai -lt 0) { $ai = $txt.IndexOf($anchor2) }
if ($ai -lt 0) { Fail "Could not find sections useMemo anchor (const sections...useMemo)" }

# Ensure we have the state vars; if not, fail fast
if ($txt -notmatch "paxMismatchCount" -or $txt -notmatch "paxMismatchErr") {
  Fail "Missing paxMismatchCount/paxMismatchErr state. P5 state must exist before inserting effect."
}

$effect = @'
  // P5: load PAX mismatch count (matches = false)
  useEffect(() => {
    (async () => {
      try {
        setPaxMismatchErr("");
        const { count, error } = await supabase
          .from("ride_pax_confirmations")
          .select("id", { count: "exact", head: true })
          .eq("matches", false);

        if (error) throw error;
        setPaxMismatchCount(typeof count === "number" ? count : 0);
      } catch (e: any) {
        setPaxMismatchErr(String(e?.message || "PAX_MISMATCH_COUNT_FAILED"));
        setPaxMismatchCount(0);
      }
    })();
  }, []);

'@

$txt = $txt.Substring(0, $ai) + $effect + $txt.Substring($ai)
Write-Host "[OK] Inserted P5 useEffect at top-level before sections useMemo"

if ($txt -eq $orig) { Fail "No changes applied (unexpected)" }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "Run build:"
Write-Host "  npm.cmd run build"
Write-Host ""
Write-Host "Suggested commit/tag:"
Write-Host "  fix(admin-control-center): move P5 pax mismatch hook to top-level"
Write-Host "  JRIDE_ADMIN_OPS_SNAPSHOT_P5_HOOK_FIX_GREEN"
