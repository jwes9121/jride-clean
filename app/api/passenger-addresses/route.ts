import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNullable(value: unknown): string | null {
  const v = text(value);
  return v ? v : null;
}

async function getPassengerUser(req: Request): Promise<{ userId: string | null }> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) return { userId: null };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) return { userId: null };

  return { userId: data.user.id };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const deviceKey = text(url.searchParams.get("device_key"));
    const { userId } = await getPassengerUser(req);

    let rows: any[] = [];

    if (userId) {
      const owned = await admin
        .from("passenger_addresses")
        .select("*")
        .eq("created_by_user_id", userId)
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(30);

      if (!owned.error && Array.isArray(owned.data)) rows = owned.data;
    }

    if (deviceKey) {
      const byDevice = await admin
        .from("passenger_addresses")
        .select("*")
        .eq("device_key", deviceKey)
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(30);

      if (!byDevice.error && Array.isArray(byDevice.data)) {
        const seen = new Set(rows.map((r) => String(r.id || "")));
        for (const row of byDevice.data) {
          const id = String(row?.id || "");
          if (!id || seen.has(id)) continue;
          rows.push(row);
          seen.add(id);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      addresses: rows
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "ADDRESS_LIST_FAILED" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = await getPassengerUser(req);

    const deviceKey = text(body?.device_key ?? body?.deviceKey);
    const addressText = text(body?.address_text ?? body?.addressText ?? body?.address);
    const label = cleanNullable(body?.label);
    const landmark = cleanNullable(body?.landmark);
    const notes = cleanNullable(body?.notes);

    const latRaw = body?.lat;
    const lngRaw = body?.lng;
    const lat = latRaw === null || latRaw === undefined || latRaw === "" ? null : Number(latRaw);
    const lng = lngRaw === null || lngRaw === undefined || lngRaw === "" ? null : Number(lngRaw);

    const isPrimary = body?.is_primary === true || body?.isPrimary === true;

    if (!deviceKey && !userId) {
      return NextResponse.json(
        { ok: false, error: "DEVICE_OR_AUTH_REQUIRED" },
        { status: 400 }
      );
    }

    if (!addressText) {
      return NextResponse.json(
        { ok: false, error: "ADDRESS_REQUIRED" },
        { status: 400 }
      );
    }

    if (isPrimary) {
      let q = admin.from("passenger_addresses").update({ is_primary: false });

      if (userId) {
        q = q.eq("created_by_user_id", userId);
      } else {
        q = q.eq("device_key", deviceKey);
      }

      await q;
    }

    const payload: any = {
      created_by_user_id: userId,
      device_key: deviceKey || null,
      label,
      address_text: addressText,
      landmark,
      notes,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      is_primary: isPrimary,
      is_active: true,
      updated_at: new Date().toISOString()
    };

    const inserted = await admin
      .from("passenger_addresses")
      .insert(payload)
      .select("*")
      .single();

    if (inserted.error) {
      return NextResponse.json(
        { ok: false, error: inserted.error.message || "ADDRESS_SAVE_FAILED" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      address: inserted.data
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "ADDRESS_SAVE_FAILED" },
      { status: 500 }
    );
  }
}
