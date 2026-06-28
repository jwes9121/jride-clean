import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function forbid() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const role = (session?.user as any)?.role ?? "user";

    if (role !== "admin") return forbid();

    const body = await req.json().catch(() => ({}));
    const requestId = body?.requestId as string | undefined;
    const note = (body?.note as string | undefined) ?? null;

    const reviewer =
      String((session?.user as any)?.email || "").trim().toLowerCase() ||
      String((session?.user as any)?.name || "").trim() ||
      "admin";

    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    const { data, error } = await supabase.rpc("admin_reject_payout_v1", {
      p_request_id: requestId,
      p_reviewed_by: reviewer,
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
    return NextResponse.json(
      { error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}