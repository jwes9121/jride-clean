import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

type VerificationStatus = "submitted" | "pending_admin" | "approved" | "rejected";

function nowIso() {
  return new Date().toISOString();
}

export async function GET() {
  const supabase = createClient();

  // ✅ Supabase cookie auth (passenger login)
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (userErr || !user?.id) {
    return NextResponse.json({ ok: true, authed: false }, { status: 200 });
  }

  const passenger_id = user.id;

  const r = await supabase
    .from("passenger_verification_requests")
    .select("*")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    authed: true,
    passenger_id,
    request: !r.error ? r.data : null,
    db_error: r.error ? r.error.message : null,
  });
}

export async function POST(req: Request) {
  const supabase = createClient();

  // ✅ Supabase cookie auth (passenger login)
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (userErr || !user?.id) {
    return NextResponse.json(
      { ok: false, error: "Not signed in (Supabase session missing)" },
      { status: 401 }
    );
  }

  const passenger_id = user.id;

  const body: any = await req.json().catch(() => ({}));
  const full_name = String(body?.full_name || "").trim();
  const town = String(body?.town || "").trim();

  const id_front_path = body?.id_front_path ? String(body.id_front_path).trim() : "";
  const selfie_with_id_path = body?.selfie_with_id_path ? String(body.selfie_with_id_path).trim() : "";

  if (!full_name) return NextResponse.json({ ok: false, error: "Full name required" }, { status: 400 });
  if (!town) return NextResponse.json({ ok: false, error: "Town required" }, { status: 400 });
  if (!id_front_path) return NextResponse.json({ ok: false, error: "ID front path required" }, { status: 400 });
  if (!selfie_with_id_path) return NextResponse.json({ ok: false, error: "Selfie-with-ID path required" }, { status: 400 });

  // Read existing request (if any)
  const existing = await supabase
    .from("passenger_verification_requests")
    .select("passenger_id,status,submitted_at,reviewed_at,reviewed_by,admin_notes,full_name,town,id_front_path,selfie_with_id_path")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json(
      { ok: false, error: "DB read failed: " + existing.error.message },
      { status: 400 }
    );
  }

  const ex = existing.data as any | null;
  const exStatus = (ex?.status ? String(ex.status) : "") as VerificationStatus | "";

  // ✅ Prevent overwriting final/forwarded states (unless rejected)
  if (ex && (exStatus === "approved" || exStatus === "pending_admin")) {
    return NextResponse.json({
      ok: true,
      request: ex,
      message:
        exStatus === "approved"
          ? "Already approved."
          : "Already forwarded to admin (pending_admin).",
    });
  }

  // If rejected, allow resubmission -> submitted
  // If no record, create -> submitted
  const nextStatus: VerificationStatus = "submitted";
  const ts = nowIso();

  if (!ex) {
    // INSERT
    const ins = await supabase
      .from("passenger_verification_requests")
      .insert({
        passenger_id,
        full_name,
        town,
        status: nextStatus,
        submitted_at: ts,
        id_front_path,
        selfie_with_id_path,
      })
      .select("*")
      .single();

    if (ins.error) {
      return NextResponse.json(
        { ok: false, error: ins.error.message, hint: "Insert blocked (likely RLS) or invalid status" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, request: ins.data });
  }

  // UPDATE (ex exists but is rejected/draft/whatever legacy)
  const upd = await supabase
    .from("passenger_verification_requests")
    .update({
      full_name,
      town,
      status: nextStatus,
      submitted_at: ts,
      reviewed_at: null,
      reviewed_by: null,
      admin_notes: null,
      id_front_path,
      selfie_with_id_path,
    })
    .eq("passenger_id", passenger_id)
    .select("*")
    .single();

  if (upd.error) {
    return NextResponse.json(
      { ok: false, error: upd.error.message, hint: "Update blocked (likely RLS) or invalid status" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, request: upd.data });
}