# PATCH-JRIDE_PHASE11I_BOOKING_POLL_NOAUTH.ps1
# Fix passenger booking poll route to NOT require supabase.auth.getUser().
# Uses known bookings columns from your schema snapshot.
# PowerShell 5 compatible, ASCII only.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }

$target = "app\api\public\passenger\booking\route.ts"
if (!(Test-Path $target)) { Fail "Missing file: $target (did you already create the route?)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item $target $bak -Force
Ok "Backup: $bak"

$code = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type Resp = {
  ok: boolean;
  code?: string;
  message?: string;
  booking?: any;
};

function json(status: number, body: Resp) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const url = new URL(req.url);
    const bookingCode = String(url.searchParams.get("code") || "").trim();
    if (!bookingCode) {
      return json(400, { ok: false, code: "MISSING_CODE", message: "Missing booking code" });
    }

    // IMPORTANT:
    // Do NOT require supabase.auth.getUser() here.
    // Your passenger session is not a Supabase Auth cookie, so polling must work without it.

    const { data: b, error } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, status, driver_id, assigned_driver_id, created_at, updated_at, created_by_user_id"
      )
      .eq("booking_code", bookingCode)
      .maybeSingle();

    if (error) {
      return json(500, { ok: false, code: "DB_ERROR", message: String(error.message || error) });
    }
    if (!b) {
      return json(404, { ok: false, code: "NOT_FOUND", message: "Booking not found" });
    }

    return json(200, { ok: true, booking: b });
  } catch (e: any) {
    return json(500, { ok: false, code: "ERROR", message: String(e?.message || e) });
  }
}
'@

[System.IO.File]::WriteAllText($target, $code, [System.Text.Encoding]::UTF8)
Ok "Patched: $target"
Ok "Next: npm run build"
