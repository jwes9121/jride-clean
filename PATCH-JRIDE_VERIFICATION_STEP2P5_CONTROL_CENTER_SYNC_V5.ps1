# PATCH-JRIDE_VERIFICATION_STEP2P5_CONTROL_CENTER_SYNC_V5.ps1
# Fixes PowerShell wildcard issue with [] in -like by using IndexOf/Contains
# This script patches ONLY Control Center (Admin page already patched by V4)

$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (!(Test-Path $path)) { throw ("Missing file: {0}" -f $path) }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "{0}.bak.{1}" -f $path, $ts
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Must-Contain-Literal($txt, $needle, $path) {
  if ($txt.IndexOf($needle) -lt 0) {
    throw ("Anchor not found in {0}`n{1}" -f $path, $needle)
  }
}

$root = (Get-Location).Path
$ccPage = Join-Path $root "app\admin\control-center\page.tsx"

Backup-File $ccPage
$txt = Get-Content $ccPage -Raw -Encoding UTF8

# We will replace ONE of these exact anchors (whichever exists)
$anchors = @(
  "  React.useEffect(() => { load(); }, []);",
  "React.useEffect(() => { load(); }, []);",
  "  React.useEffect(()=>{ load(); },[]);",
  "React.useEffect(()=>{ load(); },[]);"
)

$found = $null
foreach ($a in $anchors) {
  if ($txt.IndexOf($a) -ge 0) { $found = $a; break }
}

if (-not $found) {
  throw ("Could not find any expected Control Center effect anchor in {0}.`nTried:`n- {1}" -f $ccPage, ($anchors -join "`n- "))
}

$replacementEffect = @'
  React.useEffect(() => {
    let alive = true;

    const safeLoad = () => {
      if (!alive) return;
      load();
    };

    // Initial load
    safeLoad();

    // Reload when tab becomes visible / user refocuses window
    const onFocus = () => safeLoad();
    const onVis = () => { if (document.visibilityState === "visible") safeLoad(); };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    // BroadcastChannel (modern)
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        bc = new BroadcastChannel("jride_verification");
        bc.onmessage = (ev: any) => {
          if (ev?.data?.type === "pending_changed") safeLoad();
        };
      }
    } catch {}

    // localStorage fallback (cross-tab)
    const onStorage = (e: StorageEvent) => {
      if (e.key === "jride_verification_pending_changed") safeLoad();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
      try { bc?.close(); } catch {}
    };
  }, []);
'@

# If already patched, skip
if ($txt.IndexOf("new BroadcastChannel(""jride_verification"")") -ge 0 -or $txt.IndexOf("jride_verification_pending_changed") -ge 0) {
  Write-Host "[SKIP] Control Center already contains verification sync listeners."
} else {
  $txt = $txt.Replace($found, $replacementEffect)
  Write-Host "[OK] Patched Control Center live refresh listeners (broadcast + storage + focus)"
}

Set-Content $ccPage -Value $txt -Encoding UTF8
Write-Host "[DONE] Patched: $ccPage"
Write-Host ""
Write-Host "[NEXT] Run: npm run build"
