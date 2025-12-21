# FIX-DISPATCH-STATUS-ROUTE.ps1
# Overwrites: app\api\dispatch\status\route.ts
# Fixes: "supabaseAdmin.from is not a function" by calling supabaseAdmin()

$ErrorActionPreference = "Stop"

$repo = Get-Location
$route = Join-Path $repo "app\api\dispatch\status\route.ts"
if (-not (Test-Path $route)) { throw "Not found: $route" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$route.bak-$stamp"
Copy-Item $route $bak -Force
Write-Host "Backup: $bak" -ForegroundColor Yellow

$content = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ALLOWED = new Set([
  "pending",
  "assigned",
  "on_the_way",
  "on_trip",
  "completed",
  "cancelled",
]);

function normStatus(input: any): string {
  const s = String(input ?? "").trim().toLowerCase();

  if (!s) return "";

  // Common UI labels -> canonical DB statuses
  if (s === "on the way" || s === "on_the_way" || s === "ontheway") return "on_the_way";
  if (s === "start trip" || s === "start_trip" || s === "on trip" || s === "on_trip") return "on_trip";
  if (s === "drop off" || s === "dropoff" || s === "drop_off" || s === "completed" || s === "complete") return "completed";
  if (s === "cancel" || s === "canceled") return "cancelled";

  // Already canonical
  return s.replace(/\s+/g, "_");
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const bookingCodeRaw = body?.bookingCode ?? body?.booking_code ?? body?.code ?? body?.id;
    const bookingCode = String(bookingCodeRaw ?? "").trim();
    const toStatus = normStatus(body?.status);

    if (!bookingCode) {
      return NextResponse.json(
        { error: "MISSING_BOOKING_CODE" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!ALLOWED.has(toStatus)) {
      return NextResponse.json(
        { error: "INVALID_STATUS", message: `Status '${toStatus}' not allowed.` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // IMPORTANT: lib/supabaseAdmin exports a FUNCTION -> call it
    const sb = supabaseAdmin();

    // Try update by booking_code first
    let updated: any[] | null = null;

    {
      const { data, error } = await sb
        .from("bookings")
        .update({ status: toStatus })
        .eq("booking_code", bookingCode)
        .select("id, booking_code, status")
        .limit(1);

      if (error) {
        return NextResponse.json(
          { error: "DB_ERROR", message: error.message, details: error },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }
      updated = data ?? null;
    }

    // If nothing updated and input looks like UUID, try by id
    if ((!updated || updated.length === 0) && isUuid(bookingCode)) {
      const { data, error } = await sb
        .from("bookings")
        .update({ status: toStatus })
        .eq("id", bookingCode)
        .select("id, booking_code, status")
        .limit(1);

      if (error) {
        return NextResponse.json(
          { error: "DB_ERROR", message: error.message, details: error },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }
      updated = data ?? null;
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: "NOT_FOUND", bookingCode, status: toStatus },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { ok: true, bookingCode: updated[0]?.booking_code ?? bookingCode, status: updated[0]?.status ?? toStatus, id: updated[0]?.id ?? null },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
'@

# Write file
$dir = Split-Path -Parent $route
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

Set-Content -Path $route -Value $content -Encoding UTF8
Write-Host "OK: wrote $route" -ForegroundColor Green

# Quick sanity check
Write-Host "`n--- Quick check (top 30 lines) ---" -ForegroundColor Cyan
Get-Content $route -TotalCount 30
