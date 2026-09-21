import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type JFleetPartnerConfig = {
  id: string;
  partner_code: string;
  display_name: string;
  quote_tat_minutes: number;
  reservation_percent: number | string;
  free_cancel_hours: number;
  late_cancel_percent: number | string;
  commission_percent: number | string;
  minimum_commission: number | string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function jfleetFeatureFlagEnabled(): boolean {
  const raw = clean(process.env.JRIDE_JFLEET_ENABLED).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function getBearerToken(req: Request): string | null {
  const auth = clean(req.headers.get("authorization"));
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export async function requireJfleetPassenger(
  req: Request
): Promise<
  | { ok: true; user: { id: string; email?: string | null } }
  | { ok: false; status: number; code: string; message: string }
> {
  const token = getBearerToken(req);
  const supabase = createClient();
  const userResult = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();

  const user = userResult.data?.user;
  if (userResult.error || !user?.id) {
    return {
      ok: false,
      status: 401,
      code: "JFLEET_NOT_AUTHENTICATED",
      message: "Sign in to use JFleet.",
    };
  }

  const deviceId = clean(req.headers.get("x-device-id"));
  if (token && deviceId) {
    const admin = supabaseAdmin({ noStore: true });
    const validation = await admin.rpc("jride_passenger_validate_device_session", {
      p_user_id: user.id,
      p_device_id: deviceId,
    });

    if (validation.error) {
      return {
        ok: false,
        status: 503,
        code: "JFLEET_DEVICE_SESSION_CHECK_FAILED",
        message: "Could not validate this device session. Try again.",
      };
    }

    const result = validation.data as { ok?: boolean; error?: string } | null;
    if (!result?.ok) {
      return {
        ok: false,
        status: 401,
        code: clean(result?.error) || "JFLEET_DEVICE_SESSION_INVALID",
        message: "This passenger session is no longer active on this device.",
      };
    }
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
  };
}

export async function getActiveJfleetPartner(): Promise<
  | { ok: true; partner: JFleetPartnerConfig }
  | { ok: false; code: string; message: string }
> {
  const admin = supabaseAdmin({ noStore: true });
  const result = await admin
    .from("jfleet_partners")
    .select(
      "id,partner_code,display_name,quote_tat_minutes,reservation_percent,free_cancel_hours,late_cancel_percent,commission_percent,minimum_commission"
    )
    .eq("status", "active")
    .order("is_priority_pilot", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    return {
      ok: false,
      code: "JFLEET_PARTNER_LOOKUP_FAILED",
      message: result.error.message,
    };
  }

  if (!result.data) {
    return {
      ok: false,
      code: "JFLEET_NO_ACTIVE_PARTNER",
      message: "JFleet is not accepting quote requests yet.",
    };
  }

  return {
    ok: true,
    partner: result.data as JFleetPartnerConfig,
  };
}
