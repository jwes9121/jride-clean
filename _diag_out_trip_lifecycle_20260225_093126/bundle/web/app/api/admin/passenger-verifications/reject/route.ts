import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = createClient();

    // Require authenticated user (admin UI should already be gated)
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = body?.id ? String(body.id) : null;
    const user_id = body?.user_id ? String(body.user_id) : null;
    const reject_reason = body?.reject_reason != null ? String(body.reject_reason) : "";

    if (!id && !user_id) {
      return NextResponse.json({ ok: false, error: "Missing id or user_id" }, { status: 400 });
    }

    // Minimal, schema-safe update
    // NOTE: we only set reject_reason if the column exists; if it doesn't, Supabase will error and we surface it.
    let q = supabase
      .from("passenger_verifications")
      .update({ status: "rejected", reject_reason })
      .select("*");
    q = id ? q.eq("id", id) : q.eq("user_id", user_id as string);

    const { data, error } = await q;
    if (error) {
      console.error("[reject] error", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: Array.isArray(data) ? data[0] : data }, { status: 200 });
  } catch (e: any) {
    console.error("[reject] exception", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}