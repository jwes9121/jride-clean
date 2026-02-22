import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const requestId = body?.requestId as string | undefined;
    const reviewedBy = (body?.reviewedBy as string | undefined) ?? "admin";
    const note = (body?.note as string | undefined) ?? null;

    if (!requestId) return NextResponse.json({ error: "Missing requestId" }, { status: 400 });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
    }

    const supabase = createClient(url, key);
    const { data, error } = await supabase.rpc("admin_reject_payout_v1", {
      p_request_id: requestId,
      p_reviewed_by: reviewedBy,
      p_note: note,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data?.ok) {
      return NextResponse.json({ ok: false, ...data }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}