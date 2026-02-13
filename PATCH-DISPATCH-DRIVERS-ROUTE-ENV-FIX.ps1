# PATCH-DISPATCH-DRIVERS-ROUTE-ENV-FIX.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"
$file = Join-Path $root "app\api\dispatch\drivers\route.ts"
if (!(Test-Path $file)) { Fail "File not found: $file" }

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$file.bak.$ts"
Copy-Item $file $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$code = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseEnv() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL;

  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_KEY;

  return { url, key };
}

/**
 * Dispatch-safe driver feed
 * - One row per driver (latest location)
 * - Online/available only (if status exists)
 * - Minimal fields
 */
export async function GET() {
  try {
    const { url, key } = getSupabaseEnv();

    if (!url || !key) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_SUPABASE_ENV",
          detail: {
            has_SUPABASE_URL: !!process.env.SUPABASE_URL,
            has_SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
            has_NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
            has_NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          },
        },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key);

    const { data, error } = await supabase
      .from("driver_locations")
      .select("driver_id, driver_name, town, status, lat, lng, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "SUPABASE_QUERY_FAILED", detail: error },
        { status: 500 }
      );
    }

    // Deduplicate: keep latest row per driver
    const seen = new Set<string>();
    const drivers: any[] = [];

    for (const row of data || []) {
      const id = String((row as any).driver_id || "");
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      const st = String((row as any).status ?? "").toLowerCase();
      if (st && !["online", "available", "active"].includes(st)) continue;

      drivers.push({
        id,
        name: (row as any).driver_name ?? null,
        town: (row as any).town ?? null,
        status: (row as any).status ?? "online",
        lat: (row as any).lat ?? null,
        lng: (row as any).lng ?? null,
        last_seen: (row as any).updated_at ?? null,
      });
    }

    return NextResponse.json({ ok: true, drivers });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "UNHANDLED_EXCEPTION", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
'@

Set-Content -Path $file -Value $code -Encoding UTF8
Write-Host "[OK] Patched drivers route to use env fallbacks + clearer error output." -ForegroundColor Green

Write-Host ""
Write-Host "Retest:" -ForegroundColor Cyan
Write-Host "Invoke-RestMethod http://localhost:3000/api/dispatch/drivers" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rollback:" -ForegroundColor Yellow
Write-Host ("Copy-Item `"" + $bak + "`" `"" + $file + "`" -Force") -ForegroundColor Yellow
