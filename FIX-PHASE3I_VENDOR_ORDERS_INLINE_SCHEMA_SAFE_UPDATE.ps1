# FIX-PHASE3I_VENDOR_ORDERS_INLINE_SCHEMA_SAFE_UPDATE.ps1
# Replace missing schemaSafeUpdateBooking() call with inline schema-safe update loop.
# ASCII-safe, makes .bak backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$root = (Get-Location).Path
$target = Join-Path $root "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing: $target" }

$src = Get-Content -Raw -Encoding UTF8 $target

$pattern = '(?m)^\s*await\s+schemaSafeUpdateBooking\s*\(\s*bookingId\s*,\s*updatePayload\s*\)\s*;\s*$'
if ($src -notmatch $pattern) {
  Fail "Could not find: await schemaSafeUpdateBooking(bookingId, updatePayload);`nPaste lines 830-860 of app/api/vendor-orders/route.ts if this persists."
}

$replacement = @'
      // Inline schema-safe update (drop unknown booking columns and retry)
      let _payload: any = { ...(updatePayload as any) };

      let _lastErr: any = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const _res = await admin
          .from("bookings")
          .update(_payload)
          .eq("id", bookingId)
          .select("id")
          .single();

        if (!_res.error) {
          _lastErr = null;
          break;
        }

        _lastErr = _res.error;
        const msg = String((_res.error as any)?.message || "");
        const m =
          msg.match(/Could not find the '([^']+)' column of 'bookings' in the schema cache/i) ||
          msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"bookings"\s+does\s+not\s+exist/i);

        if (m && m[1]) {
          const col = String(m[1]);
          delete (_payload as any)[col];
          continue;
        }

        break; // unknown error -> stop retrying
      }

      if (_lastErr) {
        throw _lastErr;
      }
'@

$src2 = [regex]::Replace($src, $pattern, $replacement, 1)

$bak = "$target.bak.$ts"
Copy-Item -Force $target $bak
Ok "Backup: $bak"

Set-Content -Encoding UTF8 -NoNewline -Path $target -Value $src2
Ok "Patched: $target"
Ok "Replaced schemaSafeUpdateBooking() call with inline schema-safe update loop."
