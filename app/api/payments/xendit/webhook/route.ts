import { NextResponse } from "next/server";

function isDriverDeviceLockAllowed(body: any): boolean {
  // Minimal gate: require driver_id + device_id present
  if (!body) return false;
  const driver_id = body.driver_id || body.driverId;
  const device_id = body.device_id || body.deviceId;
  return !!(driver_id && device_id);
}

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function getHeader(req: Request, name: string) {
  return req.headers.get(name) || req.headers.get(name.toLowerCase());
}

export async function POST(req: Request) {
  
  const body = await req.json().catch(() => null);
try {
    const token = process.env.XENDIT_WEBHOOK_TOKEN || "";
    const got = getHeader(req, "x-callback-token") || "";

    if (!token) {
      return json(503, { ok: false, code: "PAYMENTS_TEMP_DISABLED", message: "Webhook token not configured." });
    }

    if (!got || got !== token) {
      return json(401, { ok: false, code: "UNAUTHORIZED", message: "Invalid webhook token." });
    }

    const payload = await req.json().catch(() => ({}));

    console.log("[xendit-webhook] received", {
      id: payload?.id,
      external_id: payload?.external_id,
      status: payload?.status,
      amount: payload?.amount,
      paid_amount: payload?.paid_amount,
      payment_method: payload?.payment_method,
      updated: payload?.updated,
    });

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}

