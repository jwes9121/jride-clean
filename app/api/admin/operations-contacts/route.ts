import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { effectiveSchedule, type Schedule } from "@/lib/operations-schedule";
import { operationsDriverRoster } from "@/lib/operations-driver-roster";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function authorizeOperationsContacts(
  db: ReturnType<typeof supabaseAdmin>
) {
  const access = await requireStaff();
  if (!access.ok) return access;

  if (access.staff.role === "admin") {
    return access;
  }

  const { data, error } = await db
    .from("operations_schedule_state")
    .select("state")
    .eq("id", 1)
    .single();

  if (error || !data) {
    return {
      ok: false as const,
      status: 503 as const,
      error: "OPERATIONS_SCHEDULE_UNAVAILABLE",
    };
  }

  const state = effectiveSchedule(data.state as Schedule);
  const employee = state.employees.find(
    (item) => item.email.trim().toLowerCase() === access.staff.email
  );

  if (!employee) {
    return {
      ok: false as const,
      status: 403 as const,
      error: "FORBIDDEN",
    };
  }

  return access;
}

async function loadDriverContacts(db: ReturnType<typeof supabaseAdmin>) {
  const locations = await db
    .from("driver_locations")
    .select("driver_id,home_town,updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (locations.error) {
    throw new Error("Driver contacts could not be loaded.");
  }

  const ids = Array.from(
    new Set((locations.data || []).map((row) => row.driver_id).filter(Boolean))
  );

  if (!ids.length) return [];

  const [drivers, profiles] = await Promise.all([
    db
      .from("drivers")
      .select("id,driver_name,driver_status,roster_status")
      .in("id", ids),
    db
      .from("driver_profiles")
      .select("driver_id,full_name,municipality,phone")
      .in("driver_id", ids),
  ]);

  if (drivers.error || profiles.error) {
    throw new Error("Driver contacts could not be loaded.");
  }

  const roster = operationsDriverRoster(
    locations.data || [],
    drivers.data || [],
    profiles.data || []
  );

  const phoneById = new Map(
    (profiles.data || []).map((profile) => [
      String(profile.driver_id),
      String(profile.phone || "").trim() || null,
    ])
  );

  return roster
    .map((driver) => ({
      id: driver.id,
      name: driver.name,
      town: driver.town,
      phone: phoneById.get(driver.id) || null,
    }))
    .sort(
      (a, b) =>
        a.town.localeCompare(b.town) || a.name.localeCompare(b.name)
    );
}

async function loadVendorContacts(db: ReturnType<typeof supabaseAdmin>) {
  const [accounts, credentials] = await Promise.all([
    db
      .from("vendor_accounts")
      .select("id,display_name,town"),
    db
      .from("vendor_onboarding_credentials")
      .select("vendor_id,vendor_name,town,contact_name,phone,status")
      .neq("status", "removed_from_pilot"),
  ]);

  if (accounts.error || credentials.error) {
    throw new Error("Vendor contacts could not be loaded.");
  }

  const accountById = new Map(
    (accounts.data || []).map((account) => [String(account.id), account])
  );

  return (credentials.data || [])
    .map((credential) => {
      const vendorId = String(credential.vendor_id || "");
      const account: any = accountById.get(vendorId) || {};

      return {
        id: vendorId,
        name:
          String(account.display_name || credential.vendor_name || "").trim() ||
          "Unnamed vendor",
        town:
          String(account.town || credential.town || "").trim() ||
          "Unassigned town",
        contact_name:
          String(credential.contact_name || "").trim() || null,
        phone: String(credential.phone || "").trim() || null,
        status: String(credential.status || "").trim() || null,
      };
    })
    .filter((vendor) => Boolean(vendor.id))
    .sort(
      (a, b) =>
        a.town.localeCompare(b.town) || a.name.localeCompare(b.name)
    );
}

export async function GET() {
  try {
    const db = supabaseAdmin();
    const access = await authorizeOperationsContacts(db);

    if (!access.ok) {
      return json({ error: access.error }, access.status);
    }

    const [drivers, vendors] = await Promise.all([
      loadDriverContacts(db),
      loadVendorContacts(db),
    ]);

    return json({
      ok: true,
      generated_at: new Date().toISOString(),
      drivers,
      vendors,
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Operations contacts could not be loaded.",
      },
      503
    );
  }
}
