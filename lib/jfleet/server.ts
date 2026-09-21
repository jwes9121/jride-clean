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

async function resolveJfleetUser(req: Request) {
  const token = getBearerToken(req);
  const supabase = createClient();
  const result = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();
  const user = result.data?.user ?? null;
  return { token, user, error: result.error ?? null };
}

export async function requireJfleetPassenger(
  req: Request
): Promise<
  | { ok: true; user: { id: string; email?: string | null } }
  | { ok: false; status: number; code: string; message: string }
> {
  const { token, user, error: userError } = await resolveJfleetUser(req);
  if (userError || !user?.id) {
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

export async function requireJfleetOwner(
  req: Request
): Promise<
  | {
      ok: true;
      user: { id: string; email?: string | null };
      partner: {
        id: string;
        partner_code: string;
        legal_name: string;
        display_name: string;
        status: string;
        is_priority_pilot: boolean;
      };
    }
  | { ok: false; status: number; code: string; message: string }
> {
  const { user, error } = await resolveJfleetUser(req);
  if (error || !user?.id) {
    return {
      ok: false,
      status: 401,
      code: "JFLEET_OWNER_NOT_AUTHENTICATED",
      message: "Sign in with the JFleet owner account.",
    };
  }

  const admin = supabaseAdmin({ noStore: true });
  const partnerResult = await admin
    .from("jfleet_partners")
    .select("id,partner_code,legal_name,display_name,status,is_priority_pilot")
    .eq("owner_user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (partnerResult.error) {
    return {
      ok: false,
      status: 503,
      code: "JFLEET_OWNER_LOOKUP_FAILED",
      message: "Could not load the JFleet partner account.",
    };
  }

  if (!partnerResult.data) {
    return {
      ok: false,
      status: 403,
      code: "JFLEET_OWNER_NOT_AUTHORIZED",
      message: "This account is not linked to a JFleet transport partner.",
    };
  }

  return {
    ok: true,
    user: { id: user.id, email: user.email ?? null },
    partner: partnerResult.data,
  };
}

export async function requireJfleetDriver(
  req: Request
): Promise<
  | {
      ok: true;
      user: { id: string; email?: string | null };
      driver: {
        id: string;
        partner_id: string;
        driver_code: string;
        full_name: string;
        status: string;
        documents_verified: boolean;
      };
    }
  | { ok: false; status: number; code: string; message: string }
> {
  const { user, error } = await resolveJfleetUser(req);
  if (error || !user?.id) {
    return {
      ok: false,
      status: 401,
      code: "JFLEET_DRIVER_NOT_AUTHENTICATED",
      message: "Sign in with your JFleet driver account.",
    };
  }

  const admin = supabaseAdmin({ noStore: true });
  const driverResult = await admin
    .from("jfleet_drivers")
    .select("id,partner_id,driver_code,full_name,status,documents_verified")
    .eq("auth_user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (driverResult.error) {
    return {
      ok: false,
      status: 503,
      code: "JFLEET_DRIVER_LOOKUP_FAILED",
      message: "Could not load the JFleet driver account.",
    };
  }

  if (
    !driverResult.data ||
    driverResult.data.status !== "active" ||
    driverResult.data.documents_verified !== true
  ) {
    return {
      ok: false,
      status: 403,
      code: "JFLEET_DRIVER_NOT_ELIGIBLE",
      message: "This JFleet driver account is not active and verified.",
    };
  }

  return {
    ok: true,
    user: { id: user.id, email: user.email ?? null },
    driver: driverResult.data,
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
