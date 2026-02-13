# FIX-JRIDE_12C1_RIDE_BUTTON_ONCLICK_INLINE_FETCH_V4.ps1
# ASCII-only | UTF8 NO BOM
# Replaces onClick={fareAccept} / onClick={fareReject} with inline handlers that POST using fetch.
# No new variables, no scope issues.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function TS(){ (Get-Date).ToString("yyyyMMdd_HHmmss") }
function ReadT($p){ if(!(Test-Path -LiteralPath $p)){ Fail "Missing file: $p" }; [IO.File]::ReadAllText($p) }
function WriteUtf8NoBom($p,$t){ $enc = New-Object Text.UTF8Encoding($false); [IO.File]::WriteAllText($p,$t,$enc) }

$target = "app\ride\page.tsx"
if(!(Test-Path -LiteralPath $target)){ Fail "Target not found: $target" }

$bak = "$target.bak.$(TS)"
Copy-Item -Force $target $bak
Write-Host "[OK] Backup: $bak"

$txt = ReadT $target
$orig = $txt

$accept = @'
onClick={async () => {
  const id = (liveBooking as any)?.id;
  if (!id) return;
  const res = await fetch("/api/public/passenger/fare/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ booking_id: id }),
  });
  const j = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (j && (j.message || j.error)) ? String(j.message || j.error) : ("HTTP " + String(res.status));
    try { window.alert("Accept failed: " + msg); } catch {}
    return;
  }
  try { window.alert("Fare accepted."); } catch {}
}}
'@

$reject = @'
onClick={async () => {
  const id = (liveBooking as any)?.id;
  if (!id) return;
  const res = await fetch("/api/public/passenger/fare/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ booking_id: id }),
  });
  const j = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (j && (j.message || j.error)) ? String(j.message || j.error) : ("HTTP " + String(res.status));
    try { window.alert("Reject failed: " + msg); } catch {}
    return;
  }
  try { window.alert("Fare rejected."); } catch {}
}}
'@

if($txt -notmatch 'onClick=\{fareAccept\}'){ Fail "ANCHOR NOT FOUND: onClick={fareAccept} not found." }
if($txt -notmatch 'onClick=\{fareReject\}'){ Fail "ANCHOR NOT FOUND: onClick={fareReject} not found." }

$txt = $txt -replace [regex]::Escape('onClick={fareAccept}'), $accept
$txt = $txt -replace [regex]::Escape('onClick={fareReject}'), $reject

if($txt -eq $orig){ Fail "No changes applied." }

WriteUtf8NoBom $target $txt
Write-Host "[OK] Rewrote fare button onClick handlers to inline fetch() posts."
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
