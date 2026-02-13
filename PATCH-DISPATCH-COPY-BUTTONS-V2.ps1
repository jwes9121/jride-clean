# PATCH-DISPATCH-COPY-BUTTONS-V2.ps1
# Dispatch-only: Adds a copyToClipboard helper + booking-code Copy button (best-effort)
# No dependency on downloadText()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }
function Backup($p){
  if(!(Test-Path $p)){ throw "Missing file: $p" }
  $bak = "$p.bak.$(Stamp)"
  Copy-Item $p $bak -Force
  Write-Host "[OK] Backup: $bak"
}
function ReadAll($p){ [IO.File]::ReadAllText($p,[Text.Encoding]::UTF8) }
function WriteAll($p,$s){ [IO.File]::WriteAllText($p,$s,[Text.Encoding]::UTF8) }
function Fail($m){ throw $m }

$path = "app\dispatch\page.tsx"
Backup $path

$txt = ReadAll $path
$orig = $txt

if($txt -match 'JRIDE_UI_COPY_HELPERS_START'){
  Fail "Copy helpers already applied."
}

# 1) Insert helper after "use client";
$rxUseClient = '(?m)^\s*"use client";\s*$'
if(-not [regex]::IsMatch($txt, $rxUseClient)){
  Fail 'Could not find the line: "use client";'
}

$helper = @'

/* JRIDE_UI_COPY_HELPERS_START */
function copyToClipboard(text: string) {
  try {
    const t = String(text || "").trim();
    if (!t) return;
    navigator.clipboard.writeText(t);
  } catch {}
}
/* JRIDE_UI_COPY_HELPERS_END */

'@

$txt = [regex]::Replace($txt, $rxUseClient, { param($m) $m.Value + $helper }, 1)
Write-Host "[OK] Inserted copyToClipboard() helper after use client."

# 2) Replace booking code render with copy buttons (best-effort)
# We try multiple known patterns and replace the first one that matches.
$repl = @'
{(() => {
  const code = String((b as any).booking_code || (b as any).id || "");
  const phone = String((b as any).rider_phone || (b as any).passenger_phone || (b as any).passenger_contact || "").trim();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{code}</span>

      <button
        type="button"
        className="rounded border px-2 py-0.5 text-[11px] hover:bg-slate-50"
        title="Copy booking code"
        onClick={() => copyToClipboard(code)}
      >
        Copy
      </button>

      {phone ? (
        <button
          type="button"
          className="rounded border px-2 py-0.5 text-[11px] hover:bg-slate-50"
          title="Copy phone"
          onClick={() => copyToClipboard(phone)}
        >
          Phone
        </button>
      ) : null}
    </span>
  );
})()}
'@

$patterns = @(
  '\{b\.booking_code\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.id\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.uuid\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.booking_id\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.code\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.bookingCode\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.booking_code\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.id\s*\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.id\s*\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.id\s*\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.id\s*\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.id\s*\}',
  '\{b\.booking_code\s*\?\s*b\.booking_code\s*:\s*b\.id\s*\}',
  '\{b\.booking_code\s*\|\|\s*b\.id\}',
  '\{b\.booking_code\s*\?\?\s*b\.id\}',
  '\{b\.booking_code\s*\|\|\s*b\.uuid\}',
  '\{b\.booking_code\s*\?\?\s*b\.uuid\}'
)

$did = $false
foreach($pat in $patterns){
  if([regex]::IsMatch($txt, $pat)){
    $txt = [regex]::Replace($txt, $pat, $repl, 1)
    Write-Host "[OK] Patched booking code cell using pattern: $pat"
    $did = $true
    break
  }
}

if(-not $did){
  Fail "Could not find a booking code render pattern to patch. Search in app/dispatch/page.tsx for 'booking_code' and paste the exact JSX line that renders it."
}

if($txt -eq $orig){ Fail "No changes produced (unexpected)." }

WriteAll $path $txt
Write-Host "[DONE] Copy buttons applied (booking code + optional phone)."
Write-Host "Next: npm.cmd run build"
