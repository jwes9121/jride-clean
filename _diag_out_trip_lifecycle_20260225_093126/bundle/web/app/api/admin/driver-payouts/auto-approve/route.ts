import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // IMPORTANT: service role key must be set on server (never expose in client)
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(500, Number(body?.limit || 50)));

    const sb = adminClient();

    // Your SQL function name may vary; keep this aligned with your DB.
    // If your function is public.admin_auto_approve_driver_payouts(limit int) return json, use this:
    const { data, error } = await sb.rpc("admin_auto_approve_driver_payouts", { p_limit: limit });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          message: "Auto-approve failed on server.",
          detail: { code: error.code, message: error.message, hint: error.hint },
        },
        { status: 400 }
      );
    }

    // If function returns json already:
    const r: any = data || {};

    const checked = Number(r.checked_count || r.checked || 0);
    const approved = Number(r.approved_count || r.approved || 0);
    const skippedIns = Number(r.skipped_insufficient || r.insufficient || 0);
    const skippedOther = Number(r.skipped_other || r.other || 0);
    const ruleEnabled = !!(r.rule_enabled ?? r.enabled ?? true);
    const runId = r.run_id ?? r.id ?? null;

    // Friendly message
    let message = "";
    if (checked === 0 && approved === 0 && skippedIns === 0 && skippedOther === 0) {
      message = "Nothing to auto-approve (no pending payouts).";
    } else if (approved === 0 && skippedIns > 0) {
      message = `No approvals. Skipped ${skippedIns} due to insufficient wallet balance.`;
    } else {
      message = `Auto-approve complete. Approved ${approved}. Skipped insufficient ${skippedIns}.`;
    }

    return NextResponse.json({
      ok: true,
      message,
      run_id: runId,
      rule_enabled: ruleEnabled,
      checked_count: checked,
      approved_count: approved,
      skipped_other: skippedOther,
      skipped_insufficient: skippedIns,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message || "Auto-approve failed (unexpected)." },
      { status: 500 }
    );
  }
}
