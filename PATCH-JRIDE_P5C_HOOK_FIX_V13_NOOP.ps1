# PATCH-JRIDE_P5C_HOOK_FIX_V13_NOOP.ps1
# Replace JRIDE_P5C_RPC_UPSERT_HOOK block with a compile-safe no-op.
# This restores GREEN without referencing any unknown identifiers (booking/body/status/supabase/etc).

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$ROOT = (Get-Location).Path
$Target = Join-Path $ROOT 'app\api\dispatch\status\route.ts'
if (!(Test-Path $Target)) { Fail "Missing file: $Target" }

# Backup
$ts = (Get-Date).ToString('yyyyMMdd_HHmmss')
Copy-Item $Target ($Target + ".bak." + $ts) -Force
Ok "[OK] Backup: $Target.bak.$ts"

$txt = Get-Content -LiteralPath $Target -Raw
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$start = '// ===== JRIDE_P5C_RPC_UPSERT_HOOK'
$end   = '// ===== END JRIDE_P5C_RPC_UPSERT_HOOK ====='

$ixS = $txt.IndexOf($start)
if ($ixS -lt 0) { Fail "Anchor not found: $start" }

$ixE = $txt.IndexOf($end, $ixS)
if ($ixE -lt 0) { Fail "Anchor not found: $end" }

$ixE2 = $ixE + $end.Length

$newBlock = @'
    // ===== JRIDE_P5C_RPC_UPSERT_HOOK (best-effort, non-fatal) =====
    // NO-OP SAFE BLOCK (P5C hook disabled due to scope/anchor mismatch)
    // This keeps build GREEN. We will re-inject a proper hook later at the real booking/body scope.
    let fare_signature: string | null = null;
    void fare_signature;
    // ===== END JRIDE_P5C_RPC_UPSERT_HOOK =====
'@

$txt2 = $txt.Substring(0, $ixS) + $newBlock + $txt.Substring($ixE2)
[System.IO.File]::WriteAllText($Target, $txt2, $Utf8NoBom)

Ok "[OK] Replaced P5C hook with NO-OP compile-safe block"
Ok "[OK] Patched: app/api/dispatch/status/route.ts"
Ok "DONE. Next: run build."
