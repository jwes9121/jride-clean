param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$Path) {
  if (!(Test-Path $Path)) { throw "Missing file: $Path" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function Backup-File([string]$Path, [string]$Tag) {
  $Dir = Split-Path -Parent $Path
  $BakDir = Join-Path $Dir "_patch_bak"
  if (!(Test-Path $BakDir)) {
    New-Item -ItemType Directory -Path $BakDir -Force | Out-Null
  }
  $Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $Name = Split-Path $Path -Leaf
  $Bak = Join-Path $BakDir "$Name.bak.$Tag.$Stamp"
  Copy-Item $Path $Bak -Force
  return $Bak
}

$Target = Join-Path $WebRoot "app\api\public\passenger\book\route.ts"
$Text = Read-Text $Target
$Bak = Backup-File -Path $Target -Tag "PASSENGER_BOOK_ASSIGN_BLOCK_FIX_V1"

$Pattern = '(?s)/\*\s*PHASE2D_SKIP_ASSIGN_FOR_TAKEOUT\s*\*/.*?/\*\s*PHASE2D_SKIP_ASSIGN_FOR_TAKEOUT_END\s*\*/'

$Replacement = @'
    /* PHASE2D_SKIP_ASSIGN_FOR_TAKEOUT */
    // Phase 6H2: CALL DISPATCH ASSIGN (single source of truth, includes busy lock)
    const baseUrl = await getBaseUrlFromHeaders(req);
    let assign: any = { ok: false, note: "Assignment skipped." };

    if (!isTakeout) {
      try {
        const assignUrl = `${baseUrl}/api/dispatch/assign`;
        const assignPayload = { booking_id: String(booking.id) };

        const resp = await fetch(assignUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-jride-admin-secret": process.env.JRIDE_ADMIN_SECRET || "",
          },
          body: JSON.stringify(assignPayload),
        });

        const rawText = await resp.text();
        let parsed: any = null;
        try {
          parsed = rawText ? JSON.parse(rawText) : null;
        } catch {}

        if (parsed && parsed.code === "INVALID_DRIVER_ID") {
          assign = {
            ok: true,
            skipped: true,
            reason: "no_driver_id",
            status: resp.status,
            statusText: resp.statusText,
            url: assignUrl,
            payload: assignPayload,
            responseText: rawText,
            responseJson: parsed,
          };
        } else {
          assign = {
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText,
            url: assignUrl,
            payload: assignPayload,
            responseText: rawText,
            responseJson: parsed,
          };
        }
      } catch (err: any) {
        assign = {
          ok: false,
          note: "Assign call failed: " + String(err?.message || err),
          errorName: String(err?.name || ""),
          errorMessage: String(err?.message || err),
          baseUrl,
          booking_id: String(booking.id),
        };
      }
    } else {
      assign = { ok: true, skipped: true, reason: "takeout_booking" };
    }
    /* PHASE2D_SKIP_ASSIGN_FOR_TAKEOUT_END */
'@

$NewText = [regex]::Replace($Text, $Pattern, $Replacement, 1)

if ($NewText -eq $Text) {
  throw "Target PHASE2D assign block not found. No changes made."
}

Write-Utf8NoBom -Path $Target -Content $NewText

Write-Host "[OK] Backup: $Bak" -ForegroundColor Green
Write-Host "[OK] Repaired: $Target" -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "1) npm run build"
Write-Host "2) Re-test one fresh passenger booking"