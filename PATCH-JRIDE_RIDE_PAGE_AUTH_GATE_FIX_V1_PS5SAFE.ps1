param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

$target = Join-Path $ProjRoot "app\ride\page.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Missing: $target" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
if (!(Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("ride.page.tsx.bak.AUTH_GATE_FIX_V1.{0}" -f $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

$txt = Get-Content -LiteralPath $target -Raw

# 1) Insert real authed state + effect (Supabase session) right after `const router = useRouter();`
$anchor = "  const router = useRouter();"
if ($txt -notlike "*$anchor*") { Fail "[FAIL] Anchor not found: const router = useRouter();" }

$insertion = @'
  const router = useRouter();

  // JRIDE_AUTH_GATE_FIX_V1: ride page must use Supabase session, not window.status
  const [authed, setAuthed] = React.useState(false);
  const [sessionChecked, setSessionChecked] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/public/auth/session", { cache: "no-store" });
        const j: any = await r.json().catch(() => ({}));
        if (!alive) return;
        setAuthed(!!j?.authed);
      } catch {
        if (!alive) return;
        setAuthed(false);
      } finally {
        if (!alive) return;
        setSessionChecked(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  // While session is still loading, don't falsely show NOT READY
  const authedForUi = sessionChecked ? authed : true;

'@

# Replace only the first occurrence so we don't duplicate the router line
$idx = $txt.IndexOf($anchor)
if ($idx -lt 0) { Fail "[FAIL] Could not locate router anchor index." }

# Make sure we don't re-apply if already patched
if ($txt -like "*JRIDE_AUTH_GATE_FIX_V1*") {
  Warn "[WARN] Patch marker already present. Skipping insertion."
} else {
  $txt = $txt.Substring(0, $idx) + $insertion + $txt.Substring($idx + $anchor.Length + 1)
  Ok "[OK] Inserted authed/sessionChecked hook block"
}

# 2) Replace the broken auth check: status === "authenticated"  -> authedForUi
$before = $txt
$txt = $txt -replace 'status\s*===\s*"authenticated"', 'authedForUi'
if ($txt -ne $before) { Ok "[OK] Replaced status===authenticated -> authedForUi" } else { Warn "[WARN] No status===authenticated found (maybe already replaced)." }

# 3) Improve the debug panel label so it shows loading properly
# {status === "authenticated" ? "yes" : "no"} -> {sessionChecked ? (authed ? "yes" : "no") : "..."}
$before = $txt
$txt = $txt -replace '\{authedForUi\s*\?\s*"yes"\s*:\s*"no"\}', '{sessionChecked ? (authed ? "yes" : "no") : "..."}'
if ($txt -ne $before) { Ok "[OK] Updated Signed-in label to use sessionChecked/authed" } else { Warn "[WARN] Signed-in label pattern not found (ok)." }

# 4) Sanity: ensure we did not leave any bare `status` usage for auth gating
if ($txt -match 'status\s*===\s*"authenticated"') { Fail "[FAIL] Found remaining status===authenticated after patch. Refusing." }

Set-Content -LiteralPath $target -Value $txt -Encoding utf8 -NoNewline
Ok ("[OK] Updated: {0}" -f $target)
Ok "[OK] PATCH COMPLETE: Ride page auth gate now uses /api/public/auth/session."
