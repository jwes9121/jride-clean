param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function EnsureDir([string]$p){ if(!(Test-Path -LiteralPath $p)){ New-Item -ItemType Directory -Path $p | Out-Null } }
function WriteUtf8NoBom([string]$Path,[string]$Content){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path,$Content,$utf8NoBom)
}

function FindNextCharIndex([string]$s, [int]$startAt, [char]$ch) {
  for ($i=$startAt; $i -lt $s.Length; $i++) {
    if ($s[$i] -eq $ch) { return $i }
  }
  return -1
}

function InsertAfterFirstBraceFrom([string]$s, [int]$fromIndex, [string]$inject) {
  $braceIdx = FindNextCharIndex $s $fromIndex '{'
  if ($braceIdx -lt 0) { return @{ ok=$false; s=$s; why="no_open_brace_found" } }
  $insertAt = $braceIdx + 1
  $out = $s.Insert($insertAt, $inject)
  return @{ ok=$true; s=$out; why="inserted_after_brace"; braceIdx=$braceIdx }
}

$verifyPath = Join-Path $ProjRoot "app\verify\page.tsx"
if(!(Test-Path -LiteralPath $verifyPath)){ throw "VERIFY_PAGE_NOT_FOUND: $verifyPath" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
EnsureDir $bakDir
$ts = Stamp
$bak = Join-Path $bakDir ("page.tsx.bak.VERIFY_AUTOFILL_SESSIONUSER_USERID_V1_1.$ts")
Copy-Item -LiteralPath $verifyPath -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$src = Get-Content -LiteralPath $verifyPath -Raw

# If already applied, stop
if ($src -match "JRIDE_VERIFY_AUTOFILL_FROM_SESSIONUSER_USERID_V1") {
  Write-Host "[OK] Patch marker already present. No change."
  exit 0
}

# Remove older resolver blocks if present (NextAuth or old session-user variants)
$src = [regex]::Replace(
  $src,
  "(?s)\r?\n\s*//\s*===== JRIDE_(NEXTAUTH_SUPABASE_UUID_RESOLVER|FORCE_UUID_FROM_SESSIONUSER)_V1 =====.*?//\s*===== /JRIDE_(NEXTAUTH_SUPABASE_UUID_RESOLVER|FORCE_UUID_FROM_SESSIONUSER)_V1 =====\s*\r?\n",
  "`r`n"
)

$inject = @'

  // ===== JRIDE_VERIFY_AUTOFILL_FROM_SESSIONUSER_USERID_V1 =====
  useEffect(() => {
    let cancelled = false;

    async function resolveUserIdFromCookieSession() {
      try {
        const r = await fetch("/api/verify/session-user", { cache: "no-store" });
        const j = await r.json().catch(() => null);

        if (cancelled) return;

        if (j?.ok && j?.user_id) {
          setUserId(String(j.user_id));
          setAuthUserPresent(true);
        }
      } catch {
        // ignore (manual UUID still works)
      }
    }

    resolveUserIdFromCookieSession();
    return () => { cancelled = true; };
  }, []);
  // ===== /JRIDE_VERIFY_AUTOFILL_FROM_SESSIONUSER_USERID_V1 =====

'@

# Try patterns in safest order
$attempts = @()

# 1) export default function Name(...) {
$attempts += @{ name="export default function named"; rx="export\s+default\s+function\s+[A-Za-z0-9_]+\s*\(" }

# 2) export default function(...) {  (anonymous)
$attempts += @{ name="export default function anonymous"; rx="export\s+default\s+function\s*\(" }

# 3) function Name(...) { ... } export default Name
$attempts += @{ name="function + export default"; rx="function\s+([A-Za-z0-9_]+)\s*\(" ; needsExport=$true }

# 4) const Name = (...) => { ... } export default Name
$attempts += @{ name="const component + export default"; rx="const\s+([A-Za-z0-9_]+)\s*=\s*\(" ; needsExport=$true }
$attempts += @{ name="const arrow + export default"; rx="const\s+([A-Za-z0-9_]+)\s*=\s*async\s*\(" ; needsExport=$true }
$attempts += @{ name="const arrow no parens + export default"; rx="const\s+([A-Za-z0-9_]+)\s*=\s*async\s*[A-Za-z0-9_]*\s*=>" ; needsExport=$true }
$attempts += @{ name="const arrow => + export default"; rx="const\s+([A-Za-z0-9_]+)\s*=\s*\([^)]*\)\s*=>" ; needsExport=$true }
$attempts += @{ name="const arrow => (no args) + export default"; rx="const\s+([A-Za-z0-9_]+)\s*=\s*\(\s*\)\s*=>" ; needsExport=$true }

$patched = $false
$why = ""

foreach ($a in $attempts) {
  $m = [regex]::Match($src, $a.rx)
  if (-not $m.Success) { continue }

  if ($a.ContainsKey("needsExport") -and $a.needsExport) {
    $compName = $m.Groups[1].Value
    if (-not $compName) { continue }
    if ($src -notmatch ("export\s+default\s+" + [regex]::Escape($compName))) {
      continue
    }
  }

  $res = InsertAfterFirstBraceFrom $src $m.Index $inject
  if ($res.ok) {
    $src = $res.s
    $patched = $true
    $why = $a.name
    break
  }
}

# Fallback: insert after first "return ("-containing component brace (best effort)
if (-not $patched) {
  $r = [regex]::Match($src, "(?m)^\s*return\s*\(")
  if ($r.Success) {
    # Find nearest preceding "{", but don't go too far back
    $searchStart = [Math]::Max(0, $r.Index - 5000)
    $segment = $src.Substring($searchStart, $r.Index - $searchStart)
    $lastBrace = $segment.LastIndexOf("{")
    if ($lastBrace -ge 0) {
      $insertAt = $searchStart + $lastBrace + 1
      $src = $src.Insert($insertAt, $inject)
      $patched = $true
      $why = "fallback_before_return"
    }
  }
}

if (-not $patched) {
  throw "PATCH_POINT_NOT_FOUND: could not locate component function/const to inject resolver."
}

WriteUtf8NoBom $verifyPath $src
Write-Host "[OK] Inserted UUID autofill resolver ($why)."
Write-Host "[OK] Patched (UTF-8 no BOM): $verifyPath"
Write-Host "[DONE] VERIFY_AUTOFILL_SESSIONUSER_USERID_V1_1 applied."