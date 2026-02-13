# PATCH-JRIDE_DISPATCH_STATUS_AUDIT_LOG_FIXED.ps1
# One file only: app\api\dispatch\status\route.ts
# PowerShell 5, ASCII only.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$root = Get-Location
$rel  = "app\api\dispatch\status\route.ts"
$path = Join-Path $root $rel

if (!(Test-Path $path)) { Fail "File not found: $path" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$path.bak.$stamp"
Copy-Item $path $bak -Force
Ok "Backup: $bak"

$txt = Get-Content -Raw -Encoding UTF8 $path

# 1) Insert helpers (only if not already present)
if ($txt -like "*function bestEffortAudit(*") {
  Info "bestEffortAudit already present (skip helper insert)."
} else {
  $patJsonErr = "(?s)function\s+jsonErr\s*\([\s\S]*?\r?\n\}"
  $m = [regex]::Match($txt, $patJsonErr)
  if (!$m.Success) { Fail "Could not locate jsonErr() function block for helper insertion." }

  $helpers = @"

function getActorFromReq(req: Request): string {
  try {
    const h: any = (req as any)?.headers;
    const v =
      h?.get?.("x-dispatcher-id") ||
      h?.get?.("x-user-id") ||
      h?.get?.("x-admin-id") ||
      h?.get?.("x-actor") ||
      "system";
    return String(v || "system");
  } catch {
    return "system";
  }
}

async function bestEffortAudit(
  supabase: ReturnType<typeof createClient>,
  entry: {
    booking_id?: string | null;
    booking_code?: string | null;
    from_status?: string | null;
    to_status?: string | null;
    actor?: string | null;
    source?: string | null;
  }
): Promise<{ warning?: string }> {
  const payload: any = {
    booking_id: entry.booking_id ?? null,
    booking_code: entry.booking_code ?? null,
    from_status: entry.from_status ?? null,
    to_status: entry.to_status ?? null,
    actor: entry.actor ?? "system",
    source: entry.source ?? "dispatch/status",
    created_at: new Date().toISOString(),
  };

  const tables = ["dispatch_audit_log", "audit_log", "status_audit"];

  for (let i = 0; i < tables.length; i++) {
    const tbl = tables[i];
    try {
      const r: any = await supabase.from(tbl).insert(payload);
      if (!r?.error) return {};
    } catch {}
  }
  return { warning: "AUDIT_LOG_INSERT_FAILED" };
}

"@

  $insertPos = $m.Index + $m.Length
  $txt = $txt.Insert($insertPos, $helpers)
  Ok "Inserted audit helpers after jsonErr()."
}

# 2) Wire audit into POST success path (robust replace around drv + return jsonOk)
$patSuccessBlock = "(?s)const\s+drv\s*=\s*await\s+bestEffortUpdateDriverLocation\s*\([\s\S]*?\)\s*;\s*\r?\n\r?\n\s*return\s+jsonOk\s*\(\s*\{\s*[\s\S]*?\}\s*\)\s*;\s*"
$m2 = [regex]::Match($txt, $patSuccessBlock)
if (!$m2.Success) {
  Fail "Could not locate POST success return block (drv + return jsonOk)."
}

$replacement = @'
  const drv = await bestEffortUpdateDriverLocation(supabase, driverId, target);

  const actor = getActorFromReq(req);
  const audit = await bestEffortAudit(supabase, {
    booking_id: String(booking.id),
    booking_code: booking.booking_code ?? null,
    from_status: cur,
    to_status: target,
    actor,
    source: "dispatch/status",
  });

  const warn = drv.warning
    ? (audit.warning ? (String(drv.warning) + "; " + String(audit.warning)) : String(drv.warning))
    : (audit.warning ? String(audit.warning) : null);

  return jsonOk({
    ok: true,
    changed: true,
    booking_id: String(booking.id),
    booking_code: booking.booking_code ?? null,
    status: target,
    allowed_next: NEXT[target] ?? [],
    booking: upd.data ?? null,
    warning: warn,
  });
'@

$txt = $txt.Substring(0, $m2.Index) + $replacement + $txt.Substring($m2.Index + $m2.Length)
Ok "Wired audit logging into POST success path (warning merged)."

Set-Content -Path $path -Value $txt -Encoding UTF8
Ok "Patched: $rel"
Info "Done."
