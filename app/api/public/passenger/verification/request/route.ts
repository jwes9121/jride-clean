import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type VerificationStatus = "submitted" | "pending_admin" | "approved" | "rejected";

function env(name: string) {
  return process.env[name] || "";
}

function nowIso() {
  return new Date().toISOString();
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) {
    throw new Error("Missing Supabase service role env (SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET() {
  const supabase = createClient();

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
  try {
    const supabase = createClient();

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

    const ct = req.headers.get("content-type") || "";

    let full_name = "";
    let town = "";
    let id_front_path = "";
    let selfie_with_id_path = "";

    async function uploadToBucket(file: File, bucketName: string, keyPrefix: string) {
      const ext = file?.name && file.name.includes(".") ? file.name.split(".").pop() : "jpg";
      const safeExt = String(ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

      const key =
        keyPrefix + "/" + passenger_id + "/" + Date.now() + "_" + Math.random().toString(16).slice(2) + "." + safeExt;

      const admin = adminClient();
      const ab = await file.arrayBuffer();

      const up = await admin.storage.from(bucketName).upload(key, ab, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });

      if (up.error) {
        throw new Error("Storage upload failed (bucket=" + bucketName + "): " + up.error.message);
      }

      return key;
    }

    try {
      if (ct.includes("multipart/form-data")) {
        const fd = await req.formData();

        full_name = String(fd.get("full_name") || fd.get("fullName") || fd.get("fullname") || "").trim();
        town = String(fd.get("town") || fd.get("Town") || "").trim();

        const idFrontAny = fd.get("id_front");
        const selfieAny = fd.get("selfie_with_id");

        id_front_path = String(fd.get("id_front_path") || "").trim();
        selfie_with_id_path = String(fd.get("selfie_with_id_path") || "").trim();

        if (!id_front_path && idFrontAny && typeof idFrontAny === "object") {
          id_front_path = await uploadToBucket(idFrontAny as File, idBucket, "id_front");
        }
        if (!selfie_with_id_path && selfieAny && typeof selfieAny === "object") {
          selfie_with_id_path = await uploadToBucket(selfieAny as File, selfieBucket, "selfie_with_id");
        }
      } else {
        const body: any = await req.json().catch(() => ({}));
        full_name = String(body?.full_name || "").trim();
        town = String(body?.town || "").trim();
        id_front_path = body?.id_front_path ? String(body.id_front_path).trim() : "";
        selfie_with_id_path = body?.selfie_with_id_path ? String(body.selfie_with_id_path).trim() : "";
      }
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: "Upload/parse failed: " + String(e?.message || e) },
        { status: 400 }
      );
    }

    if (!full_name) {
      return NextResponse.json({ ok: false, error: "Full name required" }, { status: 400 });
    }

    if (!town) {
      return NextResponse.json({ ok: false, error: "Town required" }, { status: 400 });
    }

    if (!id_front_path) {
      return NextResponse.json(
        { ok: false, error: "ID front required (upload failed or missing)." },
        { status: 400 }
      );
    }

    if (!selfie_with_id_path) {
      return NextResponse.json(
        { ok: false, error: "Selfie-with-ID required (upload failed or missing)." },
        { status: 400 }
      );
    }

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
    const exStatus = ex?.status ? String(ex.status) : "";

    if (ex && (exStatus === "approved" || exStatus === "pending_admin")) {
      return NextResponse.json({
        ok: true,
        request: ex,
        message: exStatus === "approved" ? "Already approved." : "Already forwarded to admin (pending_admin).",
      });
    }

    const nextStatus = "submitted";
    const ts = nowIso();

    if (!ex) {
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
          { ok: false, error: ins.error.message, hint: "Insert blocked or schema mismatch" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        request: ins.data,
        message: "Submitted. Please wait for review.",
      });
    }

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
        { ok: false, error: upd.error.message, hint: "Update blocked or schema mismatch" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      request: upd.data,
      message: "Submitted. Please wait for review.",
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unhandled verification submit error: " + String(e?.message || e),
      },
      { status: 500 }
    );
  }
}