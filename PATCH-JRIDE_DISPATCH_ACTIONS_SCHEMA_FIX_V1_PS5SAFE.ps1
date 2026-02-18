param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Backup-File([string]$Path, [string]$Tag) {
  if (!(Test-Path $Path)) { return }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path $Path -Leaf
  $bak = Join-Path $bakDir ("{0}.bak.{1}.{2}" -f $name, $Tag, $ts)
  Copy-Item -Force $Path $bak
  Write-Host "[OK] Backup: $bak"
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Host "== PATCH JRIDE dispatch_actions schema fix (V1 / PS5-safe) =="
Write-Host "Repo: $ProjRoot"

$path = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path $path)) { throw "Missing: $path" }

Backup-File $path "DISPATCH_ACTIONS_SCHEMA_FIX_V1"

$src = Get-Content -Raw -LiteralPath $path

# Replace the entire bestEffortDispatchAction() function with a schema-correct version
$funcPattern = '(?s)async function bestEffortDispatchAction\s*\([\s\S]*?\n\}\n'
if ($src -notmatch $funcPattern) {
  throw "bestEffortDispatchAction() not found in dispatch/status route.ts"
}

$newFunc = @'
async function bestEffortDispatchAction(
  supabase: any,
  entry: {
    trip_id: string;
    driver_id?: string | null;
    from_status?: string | null;
    to_status?: string | null;
    dispatcher_id?: string | null;
    dispatcher_name?: string | null;
    source?: string | null;
  }
): Promise<{ warning?: string | null }> {
  // Match your real public.dispatch_actions schema:
  // dispatcher_id, dispatcher_name, trip_id, driver_id, action_type, note, meta
  const payload: any = {
    trip_id: entry.trip_id,
    driver_id: entry.driver_id ?? null,
    dispatcher_id: entry.dispatcher_id ?? null,
    dispatcher_name: entry.dispatcher_name ?? null,
    action_type: "status_change",
    note: null,
    meta: {
      from_status: entry.from_status ?? null,
      to_status: entry.to_status ?? null,
      source: entry.source ?? "dispatch/status",
    },
  };

  try {
    const r = await supabase.from("dispatch_actions").insert(payload);
    if (!r?.error) return { warning: null };
    return { warning: "DISPATCH_ACTIONS_INSERT_ERROR: " + String(r.error?.message || r.error) };
  } catch (e: any) {
    return { warning: "DISPATCH_ACTIONS_INSERT_THROW: " + String(e?.message || e) };
  }
}
'@

$src2 = [regex]::Replace($src, $funcPattern, ($newFunc + "`r`n"), 1)

# Patch the injected V6C logging call (make it pass trip_id/driver_id and dispatcher_id)
# We replace ONLY inside the JRIDE_DISPATCH_ACTIONS_LOG_V6C block to avoid collateral edits.
$blockPattern = '(?s)//\s*JRIDE_DISPATCH_ACTIONS_LOG_V6C\s*\(non-blocking\)[\s\S]*?catch\s*\{\s*\}\s*'
if ($src2 -notmatch $blockPattern) {
  throw "JRIDE_DISPATCH_ACTIONS_LOG_V6C block not found (expected from prior patch)."
}

$replacementBlock = @'
  // JRIDE_DISPATCH_ACTIONS_LOG_V6C (non-blocking)
  try {
    const driverForLog =
      (booking?.driver_id ? String(booking.driver_id) :
        (booking?.assigned_driver_id ? String(booking.assigned_driver_id) : null));

    const dispatcherIdForLog =
      ((typeof actorUserId !== "undefined" && actorUserId) ? String(actorUserId) : null);

    await bestEffortDispatchAction(supabase, {
      trip_id: String(booking.id),
      driver_id: driverForLog,
      from_status: cur,
      to_status: target,
      dispatcher_id: dispatcherIdForLog,
      dispatcher_name: null,
      source: "dispatch/status",
    });
  } catch {}
'@

$src3 = [regex]::Replace($src2, $blockPattern, $replacementBlock, 1)

Write-Utf8NoBom -Path $path -Content $src3
Write-Host "[OK] Patched: $path"

Write-Host ""
Write-Host "[NEXT] Build:"
Write-Host "  npm.cmd run build"
