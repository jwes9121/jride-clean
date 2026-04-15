import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = createClient();

    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();

    const full_name = String(form.get("full_name") || "").trim();
    const town = String(form.get("town") || "").trim();

    const idFile = form.get("id_front") as File | null;
    const selfieFile = form.get("selfie_with_id") as File | null;

    if (!full_name || !town || !idFile || !selfieFile) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const userId = user.id;
    const ts = Date.now();

    const idPath = `${userId}/${ts}_id.jpg`;
    const selfiePath = `${userId}/${ts}_selfie.jpg`;

    // Upload ID
    const up1 = await supabase.storage
      .from("passenger-ids")
      .upload(idPath, idFile, { upsert: true });

    if (up1.error) {
      return NextResponse.json({ ok: false, error: up1.error.message }, { status: 500 });
    }

    // Upload selfie
    const up2 = await supabase.storage
      .from("passenger-selfies")
      .upload(selfiePath, selfieFile, { upsert: true });

    if (up2.error) {
      return NextResponse.json({ ok: false, error: up2.error.message }, { status: 500 });
    }

    // Insert or update request
    const { data, error } = await supabase
      .from("passenger_verification_requests")
      .upsert(
        {
          passenger_id: userId,
          full_name,
          town,
          id_front_path: idPath,
          selfie_with_id_path: selfiePath,
          status: "submitted",
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "passenger_id" }
      )
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}