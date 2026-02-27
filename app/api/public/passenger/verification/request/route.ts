import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

type VerificationStatus = "submitted" | "pending_admin" | "approved" | "rejected";

function nowIso() {
  return new Date().toISOString();
}

export async function GET() {
  const supabase = createClient();

  // âœ… Supabase cookie auth (passenger login)
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

  // âœ… Supabase cookie auth (passenger login)
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (userErr || !user?.id) {
    return NextResponse.json(
      { ok: false, error: "Not signed in (Supabase session missing)" },
      { status: 401 }
    );
  }

  const passenger_id = user.id;

  const idBucket = process.env.VERIFICATION_ID_BUCKET || "passenger-ids";
  const selfieBucket = process.env.VERIFICATION_SELFIE_BUCKET || "passenger-selfies";

  // Accept BOTH JSON and multipart/form-data
  const ct = req.headers.get("content-type") || "";

  let full_name = "";
  let town = "";

  // These are the DB fields your table expects:
  // - id_front_path
  // - selfie_with_id_path
  let id_front_path = "";
  let selfie_with_id_path = "";

  // Optional URL fields if your client provides them
  let id_photo_url = "";
  let selfie_photo_url = "";

  // Helper: upload a file to Supabase Storage and return its path
  async function uploadToBucket(file: File, bucketName: string, keyPrefix: string) {
    const ext = (file.name && file.name.includes(".")) ? file.name.split(".").pop() : "jpg";
    const safeExt = String(ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const key = `${keyPrefix}/${passenger_id}/${Date.now()}_${Math.random().toString(16).slice(2)}.${safeExt}`;

    const up = await supabase.storage.from(bucketName).upload(key, file, {
      contentType: file.type || "application/octet-stream",
      upsert: true
    });

    if (up.error) {
      throw new Error(`Storage upload failed (bucket=${bucketName}): ${up.error.message}`);
    }
    return key;
  }

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();

    full_name = String(fd.get("full_name") || "").trim();
    town = String(fd.get("town") || "").trim();

    // Accept either file uploads OR pre-existing path/url strings
    const idFrontAny = fd.get("id_front");
    const selfieAny = fd.get("selfie_with_id");

    id_front_path = String(fd.get("id_front_path") || "").trim();
    selfie_with_id_path = String(fd.get("selfie_with_id_path") || "").trim();

    id_photo_url = String(fd.get("id_photo_url") || "").trim();
    selfie_photo_url = String(fd.get("selfie_photo_url") || "").trim();

    // If files are provided, upload them and set paths
    if (!id_front_path && idFrontAny && typeof idFrontAny === "object") {
      const f = idFrontAny as File;
      id_front_path = await uploadToBucket(f, idBucket, "id_front");
    }
    if (!selfie_with_id_path && selfieAny && typeof selfieAny === "object") {
      const f = selfieAny as File;
      selfie_with_id_path = await uploadToBucket(f, selfieBucket, "selfie_with_id");
    }
  } else {
    // JSON fallback
    const body: any = await req.json().catch(() => ({}));
    full_name = String(body?.full_name || "").trim();
    town = String(body?.town || "").trim();

    id_front_path = body?.id_front_path ? String(body.id_front_path).trim() : "";
    selfie_with_id_path = body?.selfie_with_id_path ? String(body.selfie_with_id_path).trim() : "";

    id_photo_url = body?.id_photo_url ? String(body.id_photo_url).trim() : "";
    selfie_photo_url = body?.selfie_photo_url ? String(body.selfie_photo_url).trim() : "";
  }

  if (!full_name) return NextResponse.json({ ok: false, error: "Full name required" }, { status: 400 });
  if (!town) return NextResponse.json({ ok: false, error: "Town required" }, { status: 400 });
  if (!id_front_path) return NextResponse.json({ ok: false, error: "ID front required (file upload failed or missing). If using file upload, ensure VERIFICATION_BUCKET is set correctly on Vercel." }, { status: 400 });
  if (!selfie_with_id_path) return NextResponse.json({ ok: false, error: "Selfie-with-ID required (file upload failed or missing). If using file upload, ensure VERIFICATION_BUCKET is set correctly on Vercel." }, { status: 400 });

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

  // âœ… Prevent overwriting final/forwarded states (unless rejected)
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

