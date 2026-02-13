# PATCH-JRIDE_PHASE8A4_PURGE_BUTTON_AND_AUDIT_FORCE.ps1
# - LiveTripsClient: adds "Purge broken trips" button next to Force start/end area (guaranteed anchor)
# - Status API: inserts FORCE_STATUS audit logging before the last ok:true NextResponse.json return (robust)
# No regex. Creates backups.

$ErrorActionPreference = "Stop"
function Fail($m){ throw "[FAIL] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$client = "app\admin\livetrips\LiveTripsClient.tsx"
$statusApi = "app\api\dispatch\status\route.ts"
$purgeApiFile = "app\api\admin\livetrips\purge-broken\route.ts"

foreach($p in @($client,$statusApi,$purgeApiFile)){
  if(!(Test-Path $p)){ Fail "Missing: $p (run from repo root)" }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $client "$client.bak.$stamp" -Force
Copy-Item $statusApi "$statusApi.bak.$stamp" -Force
Ok "Backups created (*.bak.$stamp)."

# -----------------------------
# (A) LiveTripsClient.tsx: ensure purgeBrokenTrips() exists, then insert button near Force end
# -----------------------------
$ctxt = Get-Content $client -Raw
$changedClient = $false

if($ctxt.IndexOf("async function purgeBrokenTrips()") -lt 0){
  Fail "purgeBrokenTrips() helper not found. (It should exist from earlier patch. If not, tell me and I'll insert it safely.)"
}

if($ctxt.IndexOf("Purge broken trips") -lt 0){

  # Anchor on the Force end button label, since Force buttons exist in your UI now.
  $label = "Force end"
  $pLabel = $ctxt.IndexOf($label)
  if($pLabel -lt 0){
    Fail "Could not find 'Force end' label in LiveTripsClient.tsx to anchor purge button. (Force buttons appear in UI, so file should contain it.)"
  }

  # Find the closing </button> after that label
  $pClose = $ctxt.IndexOf("</button>", $pLabel)
  if($pClose -lt 0){
    Fail "Found 'Force end' but could not locate its </button> close tag."
  }

  $insertPos = $pClose + "</button>".Length

  $btn = @"

                            <button
                              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                              onClick={(e) => { e.stopPropagation(); purgeBrokenTrips().catch((err) => setLastAction(String(err?.message || err))); }}
                              title="Admin ops: cancels live trips missing booking_code"
                            >
                              Purge broken trips
                            </button>
"@

  $ctxt = $ctxt.Insert($insertPos, $btn)
  $changedClient = $true
  Ok "LiveTripsClient: inserted Purge broken trips button beside Force actions."
} else {
  Ok "LiveTripsClient: Purge button already present."
}

if($changedClient){
  Set-Content -LiteralPath $client -Value $ctxt -Encoding UTF8
  Ok "LiveTripsClient: wrote changes."
}

# -----------------------------
# (B) Status API: insert FORCE_STATUS audit logging (robust)
# -----------------------------
$atxt = Get-Content $statusApi -Raw
$changedApi = $false

# Ensure "force" variable exists (best-effort; won't fail if not found)
if($atxt.IndexOf("const force") -lt 0){
  $bodyNeedle = "const body = (await req.json().catch(() => ({})))"
  $bp = $atxt.IndexOf($bodyNeedle)
  if($bp -ge 0){
    $lineEnd = $atxt.IndexOf(";", $bp)
    if($lineEnd -ge 0){
      $atxt = $atxt.Insert($lineEnd + 1, "`r`n    const force = Boolean((body as any).force);`r`n")
      $changedApi = $true
      Ok "Status API: inserted const force = Boolean(body.force) after body parse."
    } else {
      Warn "Status API: found body parse but couldn't locate end of statement; skipping force insertion."
    }
  } else {
    Warn "Status API: could not find body parse anchor; skipping force insertion (may already exist in another form)."
  }
} else {
  Ok "Status API: force variable already present."
}

# Insert audit block only once
if($atxt.IndexOf('action: "FORCE_STATUS"') -lt 0){

  # Find LAST return NextResponse.json(...) containing ok: true within next ~400 chars
  $key = "return NextResponse.json"
  $last = -1
  $scan = 0
  while($true){
    $i = $atxt.IndexOf($key, $scan)
    if($i -lt 0){ break }
    $lookEnd = [Math]::Min($atxt.Length, $i + 500)
    $chunk = $atxt.Substring($i, $lookEnd - $i)
    if($chunk.IndexOf("ok: true") -ge 0){
      $last = $i
    }
    $scan = $i + 5
  }

  if($last -lt 0){
    Warn "Status API: could not find a success return containing ok:true. Skipping audit insertion (no fail)."
  } else {
    $audit = @"

    // Audit: forced status changes (best effort; actor may be unknown depending on auth setup)
    if (force) {
      try {
        await supabase.from("admin_audit_log").insert({
          actor_id: null,
          actor_email: null,
          action: "FORCE_STATUS",
          booking_id: (booking as any)?.id ?? null,
          booking_code: (booking as any)?.booking_code ?? null,
          from_status: (booking as any)?.status ?? null,
          to_status: status ?? null,
          meta: { source: "dispatch/status" }
        } as any);
      } catch {}
    }

"@
    $atxt = $atxt.Insert($last, $audit)
    $changedApi = $true
    Ok "Status API: inserted FORCE_STATUS audit block before success return."
  }
} else {
  Ok "Status API: FORCE_STATUS audit already present."
}

if($changedApi){
  Set-Content -LiteralPath $statusApi -Value $atxt -Encoding UTF8
  Ok "Status API: wrote changes."
} else {
  Ok "Status API: no changes needed."
}

Ok "Phase 8A4 patch applied."
