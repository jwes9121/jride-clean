import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function json(status: number, body: any) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(v || "")
  );
}

function isNumericId(v: string) {
  return /^[0-9]+$/.test(String(v || "").trim());
}

function isIdOk(v: string) {
  return isUuid(v) || isNumericId(v);
}

async function fetchDriverTx(driverId: string, limit: number) {
  const r = await supabase
    .from("driver_wallet_transactions")
    .select("id, created_at, amount, balance_after, reason, booking_id")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!r.error) return r.data || [];

  const r2 = await supabase
    .from("driver_wallet_transactions")
    .select("id, created_at, amount, balance_after, reason, booking_id")
    .eq("driver_id", driverId)
    .order("id", { ascending: false })
    .limit(limit);

  if (r2.error) throw r2.error;
  return r2.data || [];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") || "").trim();

    if (q) {
      if (q.length < 2) return json(200, { ok: true, drivers: [] });

      const r = await supabase
        .from("drivers")
        .select("id,driver_name")
        .not("driver_name", "is", null)
        .ilike("driver_name", `%${q}%`)
        .order("driver_name", { ascending: true })
        .limit(20);

      if (r.error) {
        return json(500, { ok: false, code: "SEARCH_FAILED", message: r.error.message });
      }

      const drivers = (r.data || [])
        .map((d: any) => {
          const id = String(d?.id ?? "");
          const name = String(d?.driver_name ?? "").trim() || id;
          return {
            id,
            driver_name: name,
            label: `${name} (${id})`,
          };
        });

      return json(200, { ok: true, drivers });
    }

    const driverId = String(url.searchParams.get("driver_id") || "").trim();
    if (!driverId) {
      return json(400, {
        ok: false,
        code: "MISSING_DRIVER_ID",
        message: "Provide either ?q= (autosuggest) or ?driver_id= (wallet lookup).",
      });
    }

    if (!isIdOk(driverId)) {
      return json(400, {
        ok: false,
        code: "BAD_DRIVER_ID",
        message: "driver_id must be uuid or numeric id",
      });
    }

    const { data: driver, error: driverErr } = await supabase
      .from("drivers")
      .select("id, driver_name, wallet_balance, min_wallet_required, wallet_locked, driver_status")
      .eq("id", driverId)
      .maybeSingle();

    if (driverErr) {
      return json(500, {
        ok: false,
        code: "DRIVER_READ_FAILED",
        message: driverErr.message,
      });
    }

    const last = await fetchDriverTx(driverId, 20);

    return json(200, {
      ok: true,
      driver_id: driverId,
      wallet_source: "drivers.wallet_balance",
      driver,
      last_tx: last,
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "UNHANDLED", message: String(e?.message || e) });
  }
}
