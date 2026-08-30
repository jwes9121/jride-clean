import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_TOWNS = ["Lagawe", "Lamut", "Banaue", "Hingyon", "Kiangan"] as const;
const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 24 * 60;

function json(status: number, payload: any) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
  });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function canonicalTown(value: unknown): string | null {
  const wanted = clean(value).toLowerCase();
  return ALLOWED_TOWNS.find((town) => town.toLowerCase() === wanted) || null;
}

function createAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin() {
  const session = await auth().catch(() => null as any);
  const user: any = (session as any)?.user || null;
  const role = clean(user?.role).toLowerCase();

  if (!user || role !== "admin") {
    return {
      ok: false as const,
      response: json(403, {
        ok: false,
        error: "ADMIN_REQUIRED",
        message: "Admin access is required to change Rescue Mode.",
      }),
    };
  }

  const actor =
    clean(user?.email) ||
    clean(user?.name) ||
    clean(user?.id) ||
    "admin";

  return { ok: true as const, actor };
}

export async function GET() {
  const adminAuth = await requireAdmin();
  if (!adminAuth.ok) return adminAuth.response;

  const db = createAdminClient();
  if (!db) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing Supabase service configuration.",
    });
  }

  const nowIso = new Date().toISOString();

  const [activeRes, recentRes] = await Promise.all([
    db
      .from("service_town_rescue_overrides")
      .select("id,scope,target_town,reason,enabled_at,expires_at,disabled_at,created_by,disabled_by,created_at")
      .eq("scope", "non_ride")
      .is("disabled_at", null)
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: true })
      .limit(50),
    db
      .from("service_town_rescue_overrides")
      .select("id,scope,target_town,reason,enabled_at,expires_at,disabled_at,created_by,disabled_by,created_at")
      .eq("scope", "non_ride")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  if (activeRes.error) {
    return json(500, { ok: false, error: "ACTIVE_READ_FAILED", message: activeRes.error.message });
  }

  if (recentRes.error) {
    return json(500, { ok: false, error: "HISTORY_READ_FAILED", message: recentRes.error.message });
  }

  return json(200, {
    ok: true,
    scope: "non_ride",
    ride_affected: false,
    current_enforcement: "takeout",
    active: activeRes.data || [],
    recent: recentRes.data || [],
  });
}

export async function POST(req: NextRequest) {
  const adminAuth = await requireAdmin();
  if (!adminAuth.ok) return adminAuth.response;

  const db = createAdminClient();
  if (!db) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing Supabase service configuration.",
    });
  }

  const body = await req.json().catch(() => ({} as any));
  const action = clean(body?.action).toLowerCase();
  const now = new Date();
  const nowIso = now.toISOString();

  if (action === "enable") {
    const town = canonicalTown(body?.town ?? body?.target_town);
    if (!town) {
      return json(400, {
        ok: false,
        error: "BAD_TOWN",
        message: "Select a valid JRide service town.",
      });
    }

    const reason = clean(body?.reason).replace(/\s+/g, " ");
    if (reason.length < 5 || reason.length > 300) {
      return json(400, {
        ok: false,
        error: "REASON_REQUIRED",
        message: "Enter a short operational reason (5 to 300 characters).",
      });
    }

    const durationMinutes = Math.round(Number(body?.duration_minutes ?? body?.durationMinutes ?? 240));
    if (
      !Number.isFinite(durationMinutes) ||
      durationMinutes < MIN_DURATION_MINUTES ||
      durationMinutes > MAX_DURATION_MINUTES
    ) {
      return json(400, {
        ok: false,
        error: "BAD_DURATION",
        message: "Rescue Mode duration must be between 30 minutes and 24 hours.",
      });
    }

    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000).toISOString();

    // Close any still-active override for this town before opening the new window.
    const closeExisting = await db
      .from("service_town_rescue_overrides")
      .update({
        disabled_at: nowIso,
        disabled_by: adminAuth.actor,
      })
      .eq("scope", "non_ride")
      .eq("target_town", town)
      .is("disabled_at", null)
      .gt("expires_at", nowIso);

    if (closeExisting.error) {
      return json(500, {
        ok: false,
        error: "PREVIOUS_OVERRIDE_CLOSE_FAILED",
        message: closeExisting.error.message,
      });
    }

    const insert = await db
      .from("service_town_rescue_overrides")
      .insert({
        scope: "non_ride",
        target_town: town,
        reason,
        enabled_at: nowIso,
        expires_at: expiresAt,
        created_by: adminAuth.actor,
      })
      .select("id,scope,target_town,reason,enabled_at,expires_at,disabled_at,created_by,disabled_by,created_at")
      .single();

    if (insert.error) {
      return json(500, {
        ok: false,
        error: "RESCUE_ENABLE_FAILED",
        message: insert.error.message,
      });
    }

    return json(200, {
      ok: true,
      action: "enabled",
      override: insert.data,
      ride_affected: false,
      current_enforcement: "takeout",
    });
  }

  if (action === "disable") {
    const id = Number(body?.id);
    const town = canonicalTown(body?.town ?? body?.target_town);

    if ((!Number.isFinite(id) || id <= 0) && !town) {
      return json(400, {
        ok: false,
        error: "OVERRIDE_REQUIRED",
        message: "Provide the active Rescue Mode id or town.",
      });
    }

    let update = db
      .from("service_town_rescue_overrides")
      .update({
        disabled_at: nowIso,
        disabled_by: adminAuth.actor,
      })
      .eq("scope", "non_ride")
      .is("disabled_at", null);

    if (Number.isFinite(id) && id > 0) {
      update = update.eq("id", id);
    } else if (town) {
      update = update.eq("target_town", town);
    }

    const disabled = await update
      .select("id,scope,target_town,reason,enabled_at,expires_at,disabled_at,created_by,disabled_by,created_at");

    if (disabled.error) {
      return json(500, {
        ok: false,
        error: "RESCUE_DISABLE_FAILED",
        message: disabled.error.message,
      });
    }

    return json(200, {
      ok: true,
      action: "disabled",
      disabled: disabled.data || [],
      ride_affected: false,
    });
  }

  return json(400, {
    ok: false,
    error: "BAD_ACTION",
    message: "action must be enable or disable.",
  });
}