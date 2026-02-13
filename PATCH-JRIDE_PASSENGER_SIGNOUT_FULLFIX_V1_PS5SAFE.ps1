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
function Warn($m) { Write-Host $m -ForegroundColor Yellow }

$target = Join-Path $RepoRoot "app\passenger\page.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing target: app\passenger\page.tsx" }

$src = Get-Content -LiteralPath $target -Raw

if ($src -notmatch "JRIDE_SIGNOUT_BUTTON_BEGIN") {
  Fail "[FAIL] Could not find JRIDE_SIGNOUT_BUTTON_BEGIN marker in app\\passenger\\page.tsx. Refusing to guess."
}
if ($src -notmatch "signOut") {
  Fail "[FAIL] signOut not found in app\\passenger\\page.tsx. Refusing to patch unknown shape."
}

$bak = BackupFile $target $RepoRoot
Ok ("[OK] Backup: {0}" -f $bak)
Ok ("[OK] Target: {0}" -f $target)

# -----------------------------
# PART 1: Fix Sign Out behavior
# - redirect to /auth/signin (avoid dispatch /)
# - hard redirect to avoid back-cache confusion
# -----------------------------

$blockPattern = "(?s)(/\*\s*JRIDE_SIGNOUT_BUTTON_BEGIN\s*\*/.*?/\*\s*JRIDE_SIGNOUT_BUTTON_END\s*\*/)"
$m = [regex]::Match($src, $blockPattern)
if (-not $m.Success) { Fail "[FAIL] Could not extract JRIDE signout marker block." }
$block = $m.Groups[1].Value

# Preferred handler: hard logout (no redirect) then hard navigate
$desiredOnClick = @'
onClick={async () => {
  await signOut({ redirect: false });
  window.location.href = "/auth/signin";
}}
'@

$block2 = $block

# Replace any existing onClick within the marker block with desired handler
# We match the opening button tag's onClick attribute (common patterns)
$block2 = [regex]::Replace(
  $block2,
  'onClick=\{[^}]*\}',
  $desiredOnClick.Trim(),
  1
)

if ($block2 -eq $block) {
  # Fallback: replace common old pattern exactly if regex above didn't hit
  $block2 = $block2.Replace(
    'onClick={() => signOut({ callbackUrl: "/" })}',
    $desiredOnClick.Trim()
  )
  $block2 = $block2.Replace(
    'onClick={() => signOut({ callbackUrl: "/"})}',
    $desiredOnClick.Trim()
  )
  $block2 = $block2.Replace(
    'onClick={() => signOut({ callbackUrl: "/auth/signin" })}',
    $desiredOnClick.Trim()
  )
}

if ($block2 -eq $block) {
  Fail "[FAIL] Could not update signOut handler inside JRIDE_SIGNOUT_BUTTON block. Paste the block if you changed it."
}

$src2 = $src.Replace($block, $block2)
Ok "[OK] Updated Sign out button handler (hard logout -> /auth/signin)"

# -----------------------------
# PART 2: Add pageshow guard to defeat bfcache
# If session is null, force reload to prevent cached protected UI
# -----------------------------

if ($src2 -notmatch "JRIDE_BFCACHE_GUARD_BEGIN") {
  if ($src2 -notmatch "React\.useEffect\(") {
    Fail "[FAIL] No React.useEffect found to anchor insertion. Refusing to inject bfcache guard blindly."
  }

  $guard = @'
  // JRIDE_BFCACHE_GUARD_BEGIN
  React.useEffect(() => {
    const onShow = () => {
      fetch("/api/auth/session", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!j) window.location.reload();
        })
        .catch(() => {});
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  // JRIDE_BFCACHE_GUARD_END

'@

  # Insert guard right after the first React.useEffect( occurrence (safe and predictable)
  $idx = $src2.IndexOf("React.useEffect(")
  if ($idx -lt 0) { Fail "[FAIL] Anchor React.useEffect( not found after prior check." }

  # Find end of that effect block by finding the next "}, [" or "}, []" or "}, [])" etc.
  # If we can't, we still inject immediately BEFORE first effect to avoid breaking code.
  $insertPos = $idx
  $src2 = $src2.Insert($insertPos, $guard)
  Ok "[OK] Inserted bfcache pageshow guard"
} else {
  Ok "[OK] bfcache guard already present"
}

# Final write
WriteUtf8NoBom $target $src2
Ok "[OK] Wrote UTF-8 (no BOM)"
Ok "[DONE] PATCH-JRIDE_PASSENGER_SIGNOUT_FULLFIX_V1_PS5SAFE"
