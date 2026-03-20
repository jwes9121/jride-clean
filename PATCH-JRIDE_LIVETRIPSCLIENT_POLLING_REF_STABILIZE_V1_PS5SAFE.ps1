# PATCH-JRIDE_LIVETRIPSCLIENT_POLLING_REF_STABILIZE_V1_PS5SAFE.ps1
param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }

if (-not (Test-Path -LiteralPath $WebRoot)) {
  Fail "WebRoot not found: $WebRoot"
}

$target = Join-Path $WebRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$backupDir = Join-Path $WebRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $backupDir ("LiveTripsClient.tsx.bak.POLLING_REF_STABILIZE_V1." + $stamp)
Copy-Item -LiteralPath $target -Destination $backup -Force
Ok "Backup: $backup"

$raw = Get-Content -LiteralPath $target -Raw
if ([string]::IsNullOrWhiteSpace($raw)) {
  Fail "Target file is empty: $target"
}

# 1) add refreshAllRef next to existing refs
$needleRef = '  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);'
$replaceRef = @'
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAllRef = useRef<((source?: string) => Promise<void>) | null>(null);
'@
if ($raw.IndexOf($needleRef) -lt 0) {
  Fail "Could not locate pollTimerRef declaration."
}
$raw = $raw.Replace($needleRef, $replaceRef)

# 2) add sync effect for refreshAllRef after refreshAll callback definition
$needleRefreshAll = @'
  const refreshAll = useCallback(async (source?: string) => {
    try {
      await Promise.all([loadPage(), loadDrivers()]);
      if (source) setLastAction("Refreshed via " + source);
    } catch (e: any) {
      if (source) setLastAction("Refresh failed via " + source + ": " + (e?.message ?? "unknown"));
    }
  }, [loadPage, loadDrivers]);
'@

$replaceRefreshAll = @'
  const refreshAll = useCallback(async (source?: string) => {
    try {
      await Promise.all([loadPage(), loadDrivers()]);
      if (source) setLastAction("Refreshed via " + source);
    } catch (e: any) {
      if (source) setLastAction("Refresh failed via " + source + ": " + (e?.message ?? "unknown"));
    }
  }, [loadPage, loadDrivers]);

  useEffect(() => {
    refreshAllRef.current = refreshAll;
  }, [refreshAll]);
'@
if ($raw.IndexOf($needleRefreshAll) -lt 0) {
  Fail "Could not locate refreshAll callback block."
}
$raw = $raw.Replace($needleRefreshAll, $replaceRefreshAll)

# 3) replace initial-load effect to run once and use ref
$oldInitial = @'
  useEffect(() => {
    refreshAll("initial").catch(() => {});
  }, [refreshAll]);
'@
$newInitial = @'
  useEffect(() => {
    refreshAllRef.current?.("initial").catch(() => {});
  }, []);
'@
if ($raw.IndexOf($oldInitial) -lt 0) {
  Fail "Could not locate initial-load effect."
}
$raw = $raw.Replace($oldInitial, $newInitial)

# 4) replace polling/visibility effect to run once and use ref
$oldPolling = @'
  useEffect(() => {
    const clearTimer = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const schedule = () => {
      clearTimer();
      const ms = document.visibilityState === "visible" ? POLL_MS_FOREGROUND : POLL_MS_BACKGROUND;
      pollTimerRef.current = setTimeout(async () => {
        await refreshAll("poll");
        schedule();
      }, ms);
    };

    const onVisibilityChange = () => {
      refreshAll("visibility").catch(() => {});
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimer();
    };
  }, [refreshAll]);
'@

$newPolling = @'
  useEffect(() => {
    const clearTimer = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const schedule = () => {
      clearTimer();
      const ms = document.visibilityState === "visible" ? POLL_MS_FOREGROUND : POLL_MS_BACKGROUND;
      pollTimerRef.current = setTimeout(async () => {
        await refreshAllRef.current?.("poll");
        schedule();
      }, ms);
    };

    const onVisibilityChange = () => {
      refreshAllRef.current?.("visibility").catch(() => {});
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimer();
    };
  }, []);
'@
if ($raw.IndexOf($oldPolling) -lt 0) {
  Fail "Could not locate polling effect."
}
$raw = $raw.Replace($oldPolling, $newPolling)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $raw, $utf8NoBom)
Ok "Patched: $target"

$verify = Get-Content -LiteralPath $target -Raw
$markers = @(
  'const refreshAllRef = useRef<((source?: string) => Promise<void>) | null>(null);',
  'refreshAllRef.current = refreshAll;',
  'refreshAllRef.current?.("initial").catch(() => {});',
  'await refreshAllRef.current?.("poll");',
  'refreshAllRef.current?.("visibility").catch(() => {});',
  '}, []);'
)

$missing = @()
foreach ($m in $markers) {
  if ($verify.IndexOf($m) -lt 0) { $missing += $m }
}

if ($missing.Count -gt 0) {
  Fail ("Verification failed. Missing markers: " + ($missing -join ", "))
}

Ok "Verification passed."
Info "Now run: npm run build"