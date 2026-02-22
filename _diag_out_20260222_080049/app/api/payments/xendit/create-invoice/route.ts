import { NextResponse } from "next/server";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function isEnabled() {
  return process.env.NEXT_PUBLIC_XENDIT_ENABLED === "1";
}

export async function POST(req: Request) {
  try {
    const enabled = isEnabled();
    const secret = process.env.XENDIT_SECRET_KEY || "";

    if (!enabled || !secret) {
      return json(503, {
        ok: false,
        code: "PAYMENTS_TEMP_DISABLED",
        message: "Xendit is not enabled (under verification).",
        enabled,
        hasSecret: Boolean(secret),
      });
    }

    const payload = await req.json().catch(() => ({}));
    const amount = Number(payload?.amount || 0);
    const external_id = String(payload?.external_id || "");

    if (!amount || amount <= 0 || !external_id) {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "amount and external_id are required." });
    }

    const description = payload?.description ? String(payload.description) : "JRide Wallet Top-up";
    const customer = payload?.customer || null;
    const success_redirect_url = payload?.success_redirect_url ? String(payload.success_redirect_url) : undefined;
    const failure_redirect_url = payload?.failure_redirect_url ? String(payload.failure_redirect_url) : undefined;

    const body: any = { external_id, amount, description };
    if (customer) body.customer = customer;
    if (success_redirect_url) body.success_redirect_url = success_redirect_url;
    if (failure_redirect_url) body.failure_redirect_url = failure_redirect_url;

    const auth = Buffer.from(`${secret}:`).toString("base64");

    const res = await fetch("https://api.xendit.co/v2/invoices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return json(502, {
        ok: false,
        code: "XENDIT_CREATE_INVOICE_FAILED",
        status: res.status,
        message: data?.message || "Failed to create invoice.",
        raw: data,
      });
    }

    return json(200, { ok: true, invoice: data });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}
