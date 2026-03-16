param(
  [string]$WebRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Read-Text([string]$path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$target = Join-Path $WebRoot "app\api\public\passenger\book\route.ts"
$text = Read-Text $target

$pattern = 'let\s+assign\s*:\s*any\s*=\s*\{\s*ok\s*:\s*false\s*,\s*note\s*:\s*"Assignment skipped\."\s*\}\s*;\s*if\s*\(\s*!isTakeout\s*\)\s*\{[\s\S]*?\n\s*\}'

$replacement = @'
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

        assign = {
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          url: assignUrl,
          payload: assignPayload,
          responseText: rawText,
          responseJson: parsed,
        };
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
    }
'@

$newText = [regex]::Replace($text, $pattern, $replacement, 1)

if ($newText -eq $text) {
  throw "Assignable fetch block not found by regex in app/api/public/passenger/book/route.ts"
}

Write-Utf8NoBom $target $newText
Write-Host "[OK] Patched $target" -ForegroundColor Green