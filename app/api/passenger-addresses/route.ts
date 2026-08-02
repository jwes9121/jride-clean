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
  const valueText = text(value);
  return valueText ? valueText : null;
}

function finiteCoordinate(
  value: unknown,
  minimum: number,
  maximum: number
): number | null {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < minimum || parsed > maximum) return null;

  return parsed;
}

async function getPassengerUser(
  req: Request
): Promise<{ userId: string | null }> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token) return { userId: null };

  const { data, error } = await admin.auth.getUser(token);

  if (error || !data?.user?.id) {
    return { userId: null };
  }

  return { userId: data.user.id };
}

function addressBelongsToRequester(
  row: any,
  userId: string | null,
  deviceKey: string
): boolean {
  const rowUserId = text(row?.created_by_user_id);
  const rowDeviceKey = text(row?.device_key);

  if (userId && rowUserId === userId) return true;
  if (deviceKey && rowDeviceKey === deviceKey) return true;

  return false;
}

async function clearPrimaryAddresses(
  userId: string | null,
  deviceKey: string,
  excludeAddressId: string | null
): Promise<{ error: string | null }> {
  const nowIso = new Date().toISOString();

  if (userId) {
    let userQuery = admin
      .from("passenger_addresses")
      .update({
        is_primary: false,
        updated_at: nowIso,
      })
      .eq("created_by_user_id", userId)
      .eq("is_active", true);

    if (excludeAddressId) {
      userQuery = userQuery.neq("id", excludeAddressId);
    }

    const userResult = await userQuery;

    if (userResult.error) {
      return {
        error:
          userResult.error.message ||
          "Failed to clear existing primary passenger addresses.",
      };
    }
  }

  if (deviceKey) {
    let deviceQuery = admin
      .from("passenger_addresses")
      .update({
        is_primary: false,
        updated_at: nowIso,
      })
      .eq("device_key", deviceKey)
      .eq("is_active", true);

    if (excludeAddressId) {
      deviceQuery = deviceQuery.neq("id", excludeAddressId);
    }

    const deviceResult = await deviceQuery;

    if (deviceResult.error) {
      return {
        error:
          deviceResult.error.message ||
          "Failed to clear existing device primary addresses.",
      };
    }
  }

  return { error: null };
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

      if (owned.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "ADDRESS_LIST_USER_QUERY_FAILED",
            message: owned.error.message,
          },
          { status: 500 }
        );
      }

      if (Array.isArray(owned.data)) {
        rows = owned.data;
      }
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

      if (byDevice.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "ADDRESS_LIST_DEVICE_QUERY_FAILED",
            message: byDevice.error.message,
          },
          { status: 500 }
        );
      }

      if (Array.isArray(byDevice.data)) {
        const seen = new Set(rows.map((row) => String(row?.id || "")));

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
      addresses: rows,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ADDRESS_LIST_FAILED",
        message: error?.message || "Failed to load passenger addresses.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = await getPassengerUser(req);

    const addressId = text(body?.address_id ?? body?.addressId);
    const deviceKey = text(body?.device_key ?? body?.deviceKey);
    const addressText = text(
      body?.address_text ?? body?.addressText ?? body?.address
    );

    const label = cleanNullable(body?.label);
    const landmark = cleanNullable(body?.landmark);
    const notes = cleanNullable(body?.notes);

    const lat = finiteCoordinate(body?.lat, -90, 90);
    const lng = finiteCoordinate(body?.lng, -180, 180);

    const isPrimary =
      body?.is_primary === true || body?.isPrimary === true;

    if (!deviceKey && !userId) {
      return NextResponse.json(
        {
          ok: false,
          error: "DEVICE_OR_AUTH_REQUIRED",
          message:
            "A signed-in passenger or valid device key is required.",
        },
        { status: 400 }
      );
    }

    if (!addressText) {
      return NextResponse.json(
        {
          ok: false,
          error: "ADDRESS_REQUIRED",
          message: "Delivery address is required.",
        },
        { status: 400 }
      );
    }

    if (lat === null || lng === null) {
      return NextResponse.json(
        {
          ok: false,
          error: "ADDRESS_COORDINATES_REQUIRED",
          message:
            "A valid exact delivery latitude and longitude are required.",
        },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    if (addressId) {
      const existing = await admin
        .from("passenger_addresses")
        .select("*")
        .eq("id", addressId)
        .limit(1)
        .maybeSingle();

      if (existing.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "ADDRESS_LOOKUP_FAILED",
            message: existing.error.message,
          },
          { status: 500 }
        );
      }

      if (!existing.data) {
        return NextResponse.json(
          {
            ok: false,
            error: "ADDRESS_NOT_FOUND",
            message: "The selected passenger address no longer exists.",
          },
          { status: 404 }
        );
      }

      if (
        !addressBelongsToRequester(
          existing.data,
          userId,
          deviceKey
        )
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "ADDRESS_FORBIDDEN",
            message:
              "The selected passenger address does not belong to this passenger or device.",
          },
          { status: 403 }
        );
      }

      if (isPrimary) {
        const primaryResult = await clearPrimaryAddresses(
          userId,
          deviceKey,
          addressId
        );

        if (primaryResult.error) {
          return NextResponse.json(
            {
              ok: false,
              error: "ADDRESS_PRIMARY_CLEAR_FAILED",
              message: primaryResult.error,
            },
            { status: 500 }
          );
        }
      }

      const updatePayload: Record<string, unknown> = {
        address_text: addressText,
        label,
        landmark,
        notes,
        lat,
        lng,
        is_primary: isPrimary,
        is_active: true,
        updated_at: nowIso,
      };

      if (userId && !text((existing.data as any)?.created_by_user_id)) {
        updatePayload.created_by_user_id = userId;
      }

      if (deviceKey) {
        updatePayload.device_key = deviceKey;
      }

      const updated = await admin
        .from("passenger_addresses")
        .update(updatePayload)
        .eq("id", addressId)
        .select("*")
        .single();

      if (updated.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "ADDRESS_UPDATE_FAILED",
            message: updated.error.message,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        action: "updated",
        address: updated.data,
      });
    }

    if (isPrimary) {
      const primaryResult = await clearPrimaryAddresses(
        userId,
        deviceKey,
        null
      );

      if (primaryResult.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "ADDRESS_PRIMARY_CLEAR_FAILED",
            message: primaryResult.error,
          },
          { status: 500 }
        );
      }
    }

    const insertPayload = {
      created_by_user_id: userId,
      device_key: deviceKey || null,
      label,
      address_text: addressText,
      landmark,
      notes,
      lat,
      lng,
      is_primary: isPrimary,
      is_active: true,
      updated_at: nowIso,
    };

    const inserted = await admin
      .from("passenger_addresses")
      .insert(insertPayload)
      .select("*")
      .single();

    if (inserted.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ADDRESS_INSERT_FAILED",
          message: inserted.error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      action: "inserted",
      address: inserted.data,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ADDRESS_SAVE_FAILED",
        message: error?.message || "Failed to save passenger address.",
      },
      { status: 500 }
    );
  }
}