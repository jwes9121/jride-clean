# PATCH-DISPATCH-ROW-ACTION-CHIPS.ps1
# Adds per-row ACK chips inside the Actions cell (Pending/OK/ERR), without refactors.
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

# Idempotency marker
if($txt -match "JRIDE_UI_ACK_CHIPS_START"){
  Fail "ACK chips already applied."
}

# Anchor: Actions <td className="p-2"> that contains the status buttons + LGU Fix
$pattern = '(?s)(<td\s+className="p-2"\s*>\s*)(\{Btn\("Assign"[\s\S]*?\}\s*<button[\s\S]*?LGU Fix[\s\S]*?</button>\s*)(</td>)'
$m = [regex]::Match($txt, $pattern)
if(-not $m.Success){
  Fail "Could not find Actions cell block (Btn(""Assign"")... LGU Fix)."
}

$prefix = $m.Groups[1].Value
$buttons = $m.Groups[2].Value
$suffix = $m.Groups[3].Value

$chips = @'
{/* JRIDE_UI_ACK_CHIPS_START */}
<div className="mb-1 flex flex-wrap items-center gap-2">
  {ack.state === "pending" ? (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
      Pending
    </span>
  ) : ack.state === "ok" ? (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
      OK
    </span>
  ) : ack.state === "err" ? (
    <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
      Error
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
      Idle
    </span>
  )}

  {ack.state !== "idle" && (ack as any).msg ? (
    <span className="text-[11px] text-slate-600 truncate max-w-[420px]" title={String((ack as any).msg)}>
      {String((ack as any).msg)}
    </span>
  ) : null}
</div>
{/* JRIDE_UI_ACK_CHIPS_END */}
'@

$replacement = $prefix + $chips + $buttons + $suffix
$txt = $txt.Substring(0, $m.Index) + $replacement + $txt.Substring($m.Index + $m.Length)

if($txt -eq $orig){ Fail "No changes produced (unexpected)." }
WriteAll $path $txt
Write-Host "[DONE] Row action ACK chips injected."
Write-Host "Next: npm.cmd run build"
