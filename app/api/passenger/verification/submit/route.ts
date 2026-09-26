import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  normalizeVerificationLocation,
  verificationNetworkLocation,
} from "@/lib/passenger/verificationLocation";

export async function POST(req: Request) {
  try {
    const supabase = createClient();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    const user = auth?.user;
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();

    const full_name = String(form.get("full_name") || "").trim();
    const town = String(form.get("town") || "").trim();

    const idFile = form.get("id_front") as File | null;
    const selfieFile = form.get("selfie_with_id") as File | null;
    const verificationLocation = normalizeVerificationLocation(
      {
        status: form.get("location_status"),
        latitude: form.get("location_lat"),
        longitude: form.get("location_lng"),
        accuracy_m: form.get("location_accuracy_m"),
        captured_at: form.get("location_captured_at"),
      },
      "client_geolocation"
    );
    const networkLocation = verificationNetworkLocation(req.headers);

    if (!full_name || !town || !idFile || !selfieFile) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const userId = user.id;
    const ts = Date.now();
    const submittedAt = new Date(ts).toISOString();

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
    const { data, error } = await supabaseAdmin({ noStore: true })
      .from("passenger_verification_requests")
      .upsert(
        {
          passenger_id: userId,
          full_name,
          town,
          id_front_path: idPath,
          selfie_with_id_path: selfiePath,
          status: "submitted",
          submitted_at: submittedAt,
        },
        { onConflict: "passenger_id" }
      )
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const locationInsert = await supabaseAdmin({ noStore: true })
      .from("passenger_verification_submission_locations")
      .insert({
        passenger_id: userId,
        request_submitted_at: submittedAt,
        device_status: verificationLocation.status,
        device_source: verificationLocation.source,
        device_latitude: verificationLocation.latitude,
        device_longitude: verificationLocation.longitude,
        device_accuracy_m: verificationLocation.accuracy_m,
        device_captured_at: verificationLocation.captured_at,
        declared_town: town,
        network_city: networkLocation.city,
        network_region: networkLocation.region,
        network_country: networkLocation.country,
      });

    if (locationInsert.error) {
      console.error("[passenger_verification_location] legacy insert failed", locationInsert.error.message);
    }

    return NextResponse.json(
      { ok: true, row: data, location_recorded: !locationInsert.error },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}