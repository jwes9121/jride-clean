param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE Patch: dispatch eligibility + status guards (V1 / PS5-safe) =="
Write-Host "Root: $ProjRoot"

function Get-Utf8NoBomEncoding {
  return New-Object System.Text.UTF8Encoding($false)
}

function Read-TextUtf8 {
  param([Parameter(Mandatory=$true)][string]$Path)
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-TextUtf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  [System.IO.File]::WriteAllText($Path, $Content, (Get-Utf8NoBomEncoding))
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  if (!(Test-Path -LiteralPath $Path)) {
    throw "Missing file: $Path"
  }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($Path)
  $bak = Join-Path $bakDir ($name + ".bak." + $Tag + "." + $stamp)
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Replace-Exact {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Old,
    [Parameter(Mandatory=$true)][string]$New,
    [Parameter(Mandatory=$true)][string]$Label
  )

  $content = Read-TextUtf8 -Path $Path
  if ($content.IndexOf($Old) -lt 0) {
    throw "Anchor not found for $Label in $Path"
  }

  $updated = $content.Replace($Old, $New)
  if ($updated -eq $content) {
    throw "Replacement produced no change for $Label in $Path"
  }

  Write-TextUtf8NoBom -Path $Path -Content $updated
  Write-Host "[OK] Patched: $Label"
}

$assignPath = Join-Path $ProjRoot "app\api\dispatch\assign\route.ts"
$statusPath = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
$driverLocPath = Join-Path $ProjRoot "app\api\admin\driver_locations\route.ts"

Backup-File -Path $assignPath -Tag "DISPATCH_ASSIGN_ELIGIBILITY_V1"
Backup-File -Path $statusPath -Tag "DISPATCH_STATUS_GUARDS_V1"
Backup-File -Path $driverLocPath -Tag "ADMIN_DRIVER_LOCATIONS_ALIGN_V1"

# -------------------------------------------------------------------
# 1) Replace app/api/dispatch/assign/route.ts بالكامل
# -------------------------------------------------------------------
$assignNew = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSupabaseServerClient } from "@/utils/supabase/server";

function jOk(body: any, status = 200) {
  return NextResponse.json(body, { status });
}
function jErr(code: string, message: string, status: number, extra?: any) {
  return NextResponse.json({ ok: false, code, message, ...(extra || {}) }, { status });
}

function normTown(s: any) {
  return String(s ?? "").trim().toLowerCase();
}
function isUuidLike(s: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s ?? "").trim());
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function allowRequest(req: Request): Promise<{ ok: boolean; mode?: string; user_id?: string | null }> {
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_ASSIGN || "").trim() === "1";
  if (allowUnauth) return { ok: true, mode: "allowUnauth", user_id: null };

  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret = String(
    req.headers.get("x-jride-admin-secret") ||
    req.headers.get("x-admin-secret") ||
    ""
  ).trim();

  const secretOk = Boolean(wantSecret) && Boolean(gotSecret) && gotSecret === wantSecret;
  if (secretOk) return { ok: true, mode: "adminSecret", user_id: null };

  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id ?? null;
    if (uid) return { ok: true, mode: "session", user_id: uid };
  } catch {}

  return { ok: false };
}

async function auditAssign(
  admin: any,
  row: {
    booking_id?: string | null;
    booking_code?: string | null;
    chosen_driver_id?: string | null;
    phase: string;
    ok?: boolean | null;
    code?: string | null;
    message?: string | null;
    notify_ok?: boolean | null;
    notify_duplicate?: boolean | null;
    notify_error?: string | null;
    adopted_existing_assignment?: boolean | null;
    backfill_applied?: boolean | null;
    payload?: any;
  }
) {
  try {
    await admin.from("dispatch_assign_audit").insert({
      booking_id: row.booking_id || null,
      booking_code: row.booking_code || null,
      chosen_driver_id: row.chosen_driver_id || null,
      phase: row.phase,
      ok: row.ok ?? null,
      code: row.code || null,
      message: row.message || null,
      notify_ok: row.notify_ok ?? null,
      notify_duplicate: row.notify_duplicate ?? null,
      notify_error: row.notify_error || null,
      adopted_existing_assignment: row.adopted_existing_assignment ?? null,
      backfill_applied: row.backfill_applied ?? null,
      payload: row.payload ?? null,
    });
  } catch (e) {
    console.error("DISPATCH_ASSIGN_AUDIT_FAILED", e);
  }
}

async function insertDriverNotificationBestEffort(
  admin: any,
  driverId: string,
  booking: any
): Promise<{ ok: boolean; duplicate: boolean; error?: string | null }> {
  const nowIso = new Date().toISOString();
  const bookingCode = String(booking?.booking_code ?? "").trim();
  const message = bookingCode
    ? ("New booking assigned: " + bookingCode)
    : "New booking assigned";

  try {
    const q: any = await admin
      .from("driver_notifications")
      .select("id")
      .eq("driver_id", driverId)
      .eq("type", "booking_assigned")
      .eq("message", message)
      .limit(1);

    const rows = Array.isArray(q?.data) ? q.data : [];
    if (rows.length > 0) {
      return { ok: true, duplicate: true, error: null };
    }
  } catch {}

  try {
    const ins: any = await admin
      .from("driver_notifications")
      .insert({
        driver_id: driverId,
        type: "booking_assigned",
        message,
        is_read: false,
        created_at: nowIso,
      })
      .select("id")
      .limit(1);

    if (ins?.error) {
      return { ok: false, duplicate: false, error: String(ins.error?.message || "INSERT_FAILED") };
    }

    return { ok: true, duplicate: false, error: null };
  } catch (e: any) {
    return { ok: false, duplicate: false, error: String(e?.message || e || "INSERT_FAILED") };
  }
}

async function loadBookingByResolved(admin: any, booking_id: string, booking_code: string, bookingSel: string) {
  if (booking_id) {
    const { data, error } = await admin
      .from("bookings")
      .select(bookingSel)
      .eq("id", booking_id)
      .limit(1);
    if (error) throw new Error("DB_SELECT_BOOKING: " + error.message);
    return Array.isArray(data) && data.length ? data[0] : null;
  }

  const { data, error } = await admin
    .from("bookings")
    .select(bookingSel)
    .eq("booking_code", booking_code)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error("DB_SELECT_BOOKING: " + error.message);
  return Array.isArray(data) && data.length ? data[0] : null;
}

function buildDriverEligibilityMap(rows: any[], bookingTown: string) {
  const map = new Map<string, any>();
  const bTown = normTown(bookingTown);
  const onlineLike = new Set(["online", "available", "idle", "waiting"]);

  for (const row of Array.isArray(rows) ? rows : []) {
    const driverId = String(row?.driver_id ?? "").trim();
    if (!driverId) continue;

    const rawStatus = String(row?.status ?? "").trim().toLowerCase();
    const town = normTown(row?.town);
    const homeTown = normTown(row?.home_town);
    const sameTown = !bTown || town === bTown || homeTown === bTown;
    const onlineEligible = onlineLike.has(rawStatus);

    map.set(driverId, {
      driver_id: driverId,
      status: rawStatus || null,
      town: row?.town ?? null,
      home_town: row?.home_town ?? null,
      updated_at: row?.updated_at ?? null,
      same_town: sameTown,
      online_eligible: onlineEligible,
      eligible: sameTown && onlineEligible,
    });
  }

  return map;
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  let admin: any = null;
  let auditBookingId: string | null = null;
  let auditBookingCode: string | null = null;
  let auditDriverId: string | null = null;

  try {
    const gate = await allowRequest(req);
    if (!gate.ok) {
      return jErr("UNAUTHORIZED", "Not authenticated (admin secret or valid session required).", 401);
    }

    const body = await req.json().catch(() => ({} as any));
    const booking_code = String(body?.booking_code ?? body?.bookingCode ?? "").trim();
    const booking_id = String(body?.booking_id ?? body?.bookingId ?? "").trim();
    const requested_driver_id = String(body?.driver_id ?? body?.driverId ?? "").trim();

    auditBookingId = booking_id || null;
    auditBookingCode = booking_code || null;

    if (!booking_code && !booking_id) {
      return jErr("BAD_REQUEST", "Provide booking_code or booking_id.", 400);
    }
    if (requested_driver_id && !isUuidLike(requested_driver_id)) {
      return jErr("BAD_REQUEST", "driver_id must be a UUID.", 400);
    }

    admin = getAdminClient();

    const bookingSel =
      "id, booking_code, status, town, created_at, updated_at, assigned_driver_id, assigned_at, driver_id";

    let booking: any = null;
    try {
      booking = await loadBookingByResolved(admin, booking_id, booking_code, bookingSel);
    } catch (e: any) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        phase: "load_booking_failed",
        ok: false,
        code: "DB_SELECT_BOOKING",
        message: String(e?.message || e),
      });
      return jErr("DB_SELECT_BOOKING", String(e?.message || e), 500);
    }

    if (!booking) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        phase: "booking_not_found",
        ok: false,
        code: "BOOKING_NOT_FOUND",
        message: "Booking not found.",
      });
      return jErr("BOOKING_NOT_FOUND", "Booking not found.", 404, { booking_code, booking_id });
    }

    auditBookingId = String(booking.id);
    auditBookingCode = String(booking.booking_code || "");

    const bTown = normTown(booking.town);
    const bStatus = String(booking.status ?? "").trim();

    const assignable = new Set(["requested", "booked_ok", "booked", "pending", "created", "", "assigned"]);

    if (!assignable.has(bStatus)) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        phase: "not_assignable",
        ok: false,
        code: "NOT_ASSIGNABLE",
        message: "Booking status is not assignable.",
        payload: { status: bStatus },
      });
      return jErr("NOT_ASSIGNABLE", "Booking status is not assignable.", 409, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        status: bStatus,
      });
    }

    const cutoffMinutes = Number(process.env.JRIDE_DRIVER_FRESH_MINUTES || "10");
    const cutoffIso = new Date(Date.now() - cutoffMinutes * 60 * 1000).toISOString();

    const { data: locs, error: locErr } = await admin
      .from("driver_locations")
      .select("driver_id, status, updated_at, town, home_town")
      .gte("updated_at", cutoffIso)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (locErr) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        phase: "load_locations_failed",
        ok: false,
        code: "DB_SELECT_LOCATIONS",
        message: locErr.message,
      });
      return jErr("DB_SELECT_LOCATIONS", locErr.message, 500);
    }

    const eligibilityMap = buildDriverEligibilityMap(Array.isArray(locs) ? locs : [], String(booking.town ?? ""));
    const allRecent = Array.from(eligibilityMap.values());
    const allOnline = allRecent.filter((r: any) => r.online_eligible);
    const townMatches = allOnline.filter((r: any) => r.same_town);

    const counts = {
      cutoff_minutes: cutoffMinutes,
      recent_rows: allRecent.length,
      online_recent: allOnline.length,
      online_town_recent: townMatches.length,
      booking_town: booking.town ?? null,
      eligible_driver_ids: townMatches.map((r: any) => r.driver_id),
      fallback_online_driver_ids: allOnline.map((r: any) => r.driver_id),
    };

    let chosenDriverId = "";
    if (requested_driver_id) {
      const requested = eligibilityMap.get(requested_driver_id) || null;
      auditDriverId = requested_driver_id;

      if (!requested) {
        await auditAssign(admin, {
          booking_id: auditBookingId,
          booking_code: auditBookingCode,
          chosen_driver_id: requested_driver_id,
          phase: "requested_driver_not_recent",
          ok: false,
          code: "REQUESTED_DRIVER_NOT_RECENT",
          message: "Requested driver has no recent driver_locations row within cutoff.",
          payload: counts,
        });
        return jErr("REQUESTED_DRIVER_NOT_RECENT", "Requested driver has no recent driver_locations row within cutoff.", 409, counts);
      }

      if (!requested.online_eligible) {
        await auditAssign(admin, {
          booking_id: auditBookingId,
          booking_code: auditBookingCode,
          chosen_driver_id: requested_driver_id,
          phase: "requested_driver_not_online",
          ok: false,
          code: "REQUESTED_DRIVER_NOT_ONLINE",
          message: "Requested driver is not online-eligible.",
          payload: {
            status: requested.status,
            town: requested.town,
            home_town: requested.home_town,
            updated_at: requested.updated_at,
            counts,
          },
        });
        return jErr("REQUESTED_DRIVER_NOT_ONLINE", "Requested driver is not online-eligible.", 409, {
          status: requested.status,
          town: requested.town,
          home_town: requested.home_town,
          updated_at: requested.updated_at,
          counts,
        });
      }

      if (!requested.same_town) {
        await auditAssign(admin, {
          booking_id: auditBookingId,
          booking_code: auditBookingCode,
          chosen_driver_id: requested_driver_id,
          phase: "requested_driver_wrong_town",
          ok: false,
          code: "REQUESTED_DRIVER_WRONG_TOWN",
          message: "Requested driver is not from the booking town.",
          payload: {
            booking_town: booking.town ?? null,
            driver_town: requested.town,
            driver_home_town: requested.home_town,
            counts,
          },
        });
        return jErr("REQUESTED_DRIVER_WRONG_TOWN", "Requested driver is not from the booking town.", 409, {
          booking_town: booking.town ?? null,
          driver_town: requested.town,
          driver_home_town: requested.home_town,
          counts,
        });
      }

      chosenDriverId = requested_driver_id;
    } else {
      chosenDriverId = (townMatches.length ? townMatches : allOnline)[0]?.driver_id || "";
      auditDriverId = chosenDriverId || null;
    }

    if (!chosenDriverId) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        chosen_driver_id: auditDriverId,
        phase: "no_available_driver",
        ok: false,
        code: "NO_AVAILABLE_DRIVER",
        message: "No online drivers with recent location updates.",
        payload: counts,
      });
      return jErr("NO_AVAILABLE_DRIVER", "No online drivers with recent location updates.", 409, counts);
    }

    const { data: prof, error: profErr } = await admin
      .from("driver_profiles")
      .select("driver_id, full_name, municipality")
      .eq("driver_id", chosenDriverId)
      .limit(1);

    if (profErr) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        chosen_driver_id: auditDriverId,
        phase: "driver_profile_failed",
        ok: false,
        code: "DB_SELECT_DRIVER_PROFILE",
        message: profErr.message,
      });
      return jErr("DB_SELECT_DRIVER_PROFILE", profErr.message, 500, { driver_id: chosenDriverId, counts });
    }
    if (!Array.isArray(prof) || !prof.length) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        chosen_driver_id: auditDriverId,
        phase: "driver_profile_missing",
        ok: false,
        code: "DRIVER_PROFILE_MISSING",
        message: "Chosen driver_id not found in driver_profiles.",
      });
      return jErr("DRIVER_PROFILE_MISSING", "Chosen driver_id not found in driver_profiles.", 409, {
        driver_id: chosenDriverId,
        counts,
      });
    }

    const patch: any = {
      status: "assigned",
      driver_id: chosenDriverId,
      assigned_driver_id: chosenDriverId,
      assigned_at: new Date().toISOString(),
    };

    const { data: upd, error: updErr } = await admin
      .from("bookings")
      .update(patch)
      .eq("id", booking.id)
      .is("assigned_driver_id", null)
      .is("assigned_at", null)
      .select(bookingSel)
      .limit(1);

    if (updErr) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        chosen_driver_id: auditDriverId,
        phase: "update_failed",
        ok: false,
        code: "DB_UPDATE_ASSIGN",
        message: updErr.message,
      });
      return jErr("DB_UPDATE_ASSIGN", updErr.message, 500, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        driver_id: chosenDriverId,
      });
    }

    let updated = Array.isArray(upd) && upd.length ? upd[0] : null;
    let adoptedExisting = false;
    let backfillApplied = false;

    if (!updated) {
      let current: any = null;
      try {
        current = await loadBookingByResolved(admin, String(booking.id), "", bookingSel);
      } catch (e: any) {
        await auditAssign(admin, {
          booking_id: auditBookingId,
          booking_code: auditBookingCode,
          chosen_driver_id: auditDriverId,
          phase: "reload_failed",
          ok: false,
          code: "DB_RELOAD_BOOKING",
          message: String(e?.message || e),
        });
        return jErr("DB_RELOAD_BOOKING", String(e?.message || e), 500, {
          booking_id: booking.id,
          booking_code: booking.booking_code,
          driver_id: chosenDriverId,
        });
      }

      const currentStatus = String(current?.status ?? "").trim();
      const currentDriverId = String(current?.driver_id ?? "").trim();
      const currentAssignedDriverId = String(current?.assigned_driver_id ?? "").trim();

      const sameDriverAlreadyAssigned =
        current &&
        currentStatus === "assigned" &&
        (
          (currentDriverId && currentDriverId === chosenDriverId) ||
          (currentAssignedDriverId && currentAssignedDriverId === chosenDriverId)
        );

      if (!sameDriverAlreadyAssigned) {
        await auditAssign(admin, {
          booking_id: auditBookingId,
          booking_code: auditBookingCode,
          chosen_driver_id: auditDriverId,
          phase: "assign_race_lost",
          ok: false,
          code: "ASSIGN_RACE_LOST",
          message: "Booking was already assigned or changed.",
          payload: {
            current_status: currentStatus || null,
            current_driver_id: currentDriverId || null,
            current_assigned_driver_id: currentAssignedDriverId || null,
          },
        });
        return jErr("ASSIGN_RACE_LOST", "Booking was already assigned or changed.", 409, {
          booking_id: booking.id,
          booking_code: booking.booking_code,
          driver_id: chosenDriverId,
          current_status: currentStatus || null,
          current_driver_id: currentDriverId || null,
          current_assigned_driver_id: currentAssignedDriverId || null,
        });
      }

      adoptedExisting = true;

      const needsBackfill =
        current &&
        (
          String(current?.driver_id ?? "").trim() !== chosenDriverId ||
          String(current?.assigned_driver_id ?? "").trim() !== chosenDriverId ||
          !String(current?.assigned_at ?? "").trim()
        );

      if (needsBackfill) {
        const backfillPatch: any = {
          status: "assigned",
          driver_id: chosenDriverId,
          assigned_driver_id: chosenDriverId,
          assigned_at: String(current?.assigned_at ?? "").trim() || new Date().toISOString(),
        };

        const { data: bf, error: bfErr } = await admin
          .from("bookings")
          .update(backfillPatch)
          .eq("id", booking.id)
          .select(bookingSel)
          .limit(1);

        if (bfErr) {
          await auditAssign(admin, {
            booking_id: auditBookingId,
            booking_code: auditBookingCode,
            chosen_driver_id: auditDriverId,
            phase: "backfill_failed",
            ok: false,
            code: "DB_BACKFILL_ASSIGN",
            message: bfErr.message,
          });
          return jErr("DB_BACKFILL_ASSIGN", bfErr.message, 500, {
            booking_id: booking.id,
            booking_code: booking.booking_code,
            driver_id: chosenDriverId,
          });
        }

        updated = Array.isArray(bf) && bf.length ? bf[0] : current;
        backfillApplied = true;
      } else {
        updated = current;
      }
    }

    const finalBooking = updated;
    if (!finalBooking) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        chosen_driver_id: auditDriverId,
        phase: "final_booking_missing",
        ok: false,
        code: "ASSIGN_FINAL_BOOKING_MISSING",
        message: "Assigned booking could not be reloaded.",
      });
      return jErr("ASSIGN_FINAL_BOOKING_MISSING", "Assigned booking could not be reloaded.", 500, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        driver_id: chosenDriverId,
      });
    }

    let notifyOk = false;
    let notifyDuplicate = false;
    let notifyError: string | null = null;

    const notifyRes = await insertDriverNotificationBestEffort(admin, chosenDriverId, finalBooking);
    notifyOk = !!notifyRes.ok;
    notifyDuplicate = !!notifyRes.duplicate;
    notifyError = notifyRes.error ?? null;

    await auditAssign(admin, {
      booking_id: String(finalBooking.id),
      booking_code: String(finalBooking.booking_code || ""),
      chosen_driver_id: chosenDriverId,
      phase: "final_success",
      ok: true,
      code: "OK",
      message: "Assignment completed.",
      notify_ok: notifyOk,
      notify_duplicate: notifyDuplicate,
      notify_error: notifyError,
      adopted_existing_assignment: adoptedExisting,
      backfill_applied: backfillApplied,
      payload: {
        counts,
      },
    });

    return jOk({
      ok: true,
      assign_ok: true,
      notify_ok: notifyOk,
      notify_duplicate: notifyDuplicate,
      notify_error: notifyError,
      adopted_existing_assignment: adoptedExisting,
      backfill_applied: backfillApplied,
      booking_id: finalBooking.id,
      booking_code: finalBooking.booking_code,
      assigned_driver_id: chosenDriverId,
      counts,
      ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    console.error("DISPATCH_ASSIGN_FATAL", e);
    if (admin) {
      await auditAssign(admin, {
        booking_id: auditBookingId,
        booking_code: auditBookingCode,
        chosen_driver_id: auditDriverId,
        phase: "fatal",
        ok: false,
        code: "SERVER_ERROR",
        message: String(e?.message || e),
      });
    }
    return jErr("SERVER_ERROR", String(e?.message || e), 500, { ms: Date.now() - startedAt });
  }
}
'@
Write-TextUtf8NoBom -Path $assignPath -Content $assignNew
Write-Host "[OK] Replaced: app/api/dispatch/assign/route.ts"

# -------------------------------------------------------------------
# 2) Replace app/api/admin/driver_locations/route.ts بالكامل
# -------------------------------------------------------------------
$driverLocNew = @'
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DriverRowDb = {
  id?: string | null;
  driver_id?: string | null;
  status?: string | null;
  town?: string | null;
  home_town?: string | null;
  lat?: number | null;
  lng?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: any;
};

function toPhilippineTime(input: string | null | undefined) {
  if (!input) return null;
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function ageSecondsFromIso(input: string | null | undefined) {
  if (!input) return null;
  const ms = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 1000));
}

export async function GET() {
  try {
    const staleAfterSeconds = 120;
    const assignCutoffMinutes = Number(process.env.JRIDE_DRIVER_FRESH_MINUTES || "10");
    const assignCutoffSeconds = assignCutoffMinutes * 60;
    const onlineLike = new Set(["online", "available", "idle", "waiting"]);

    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("driver_locations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("ADMIN_DRIVER_LOCATIONS_ERROR", error);
      return NextResponse.json(
        {
          ok: false,
          error: "ADMIN_DRIVER_LOCATIONS_ERROR",
          message: error.message,
        },
        { status: 500 }
      );
    }

    const rows = Array.isArray(data) ? (data as DriverRowDb[]) : [];

    const drivers = rows.map((row) => {
      const updatedAt = row.updated_at ?? null;
      const createdAt = row.created_at ?? null;
      const ageSeconds = ageSecondsFromIso(updatedAt);
      const isStale = ageSeconds == null ? true : ageSeconds > staleAfterSeconds;
      const rawStatus = String(row.status ?? "").trim().toLowerCase();
      const effectiveStatus = isStale ? "stale" : rawStatus;
      const assignFresh = ageSeconds == null ? false : ageSeconds <= assignCutoffSeconds;
      const assignOnlineEligible = onlineLike.has(rawStatus);
      const assignEligible = assignFresh && assignOnlineEligible;

      return {
        ...row,
        updated_at: updatedAt,
        updated_at_ph: toPhilippineTime(updatedAt),
        created_at: createdAt,
        created_at_ph: toPhilippineTime(createdAt),
        age_seconds: ageSeconds,
        is_stale: isStale,
        age_min: ageSeconds == null ? null : Math.floor(ageSeconds / 60),
        effective_status: effectiveStatus,
        assign_cutoff_minutes: assignCutoffMinutes,
        assign_fresh: assignFresh,
        assign_online_eligible: assignOnlineEligible,
        assign_eligible: assignEligible,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        source: "app/api/admin/driver_locations/route.ts",
        stale_after_seconds: staleAfterSeconds,
        assign_cutoff_minutes: assignCutoffMinutes,
        server_now_utc: new Date().toISOString(),
        server_now_ph: new Date().toLocaleString("en-PH", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }),
        count: drivers.length,
        drivers,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("ADMIN_DRIVER_LOCATIONS_UNEXPECTED", err);
    return NextResponse.json(
      {
        ok: false,
        error: "ADMIN_DRIVER_LOCATIONS_UNEXPECTED",
        message: err?.message ?? "Unexpected error",
      },
      { status: 500 }
    );
  }
}
'@
Write-TextUtf8NoBom -Path $driverLocPath -Content $driverLocNew
Write-Host "[OK] Replaced: app/api/admin/driver_locations/route.ts"

# -------------------------------------------------------------------
# 3) Patch app/api/dispatch/status/route.ts
# -------------------------------------------------------------------

$statusOldWallet = @'
async function bestEffortWalletSyncOnComplete(
  supabase: ReturnType<typeof createClient>,
  booking: any,
  warnings: string[]
): Promise<{ warning?: string }> {
  const bookingId = booking?.id ? String(booking.id) : null;
  const serviceType = String(booking?.service_type ?? booking?.serviceType ?? "").toLowerCase();
  const vendorId = booking?.vendor_id ? String(booking.vendor_id) : null;

  

  // STEP5E_CALL_SITE: Emergency fee wallet split (idempotent, completion-only)
  await step5eBestEffortEmergencyWalletSplit(supabase, booking, warnings);


  // 1) Apply platform/company cut (driver wallet deduction)
  if (bookingId) {
  const warnings: string[] = [];    try {
      const r: any = await supabase.rpc("process_booking_wallet_cut", {
        p_booking_id: bookingId,
      });
      if (r?.error) warnings.push("WALLET_CUT_RPC_ERROR: " + r.error.message);
    } catch (e: any) {
      warnings.push("WALLET_CUT_RPC_ERROR: " + String(e?.message || e));
    }
  } else {
    warnings.push("WALLET_CUT_SKIPPED_NO_BOOKING_ID");
  }

  // 2) Vendor wallet for takeout only
  if (serviceType === "takeout" && vendorId) {
    try {
      const r: any = await supabase.rpc("sync_vendor_takeout_wallet", {
        v_vendor_id: vendorId,
      });
      if (r?.error) warnings.push("VENDOR_SYNC_RPC_ERROR: " + r.error.message);
    } catch (e: any) {
      warnings.push("VENDOR_SYNC_RPC_ERROR: " + String(e?.message || e));
    }
  }

  return warnings.length ? { warning: ((globalThis as any).__jrideWarnings ?? []).join("; ") } : {};
}
'@

$statusNewWallet = @'
async function bestEffortWalletSyncOnComplete(
  supabase: ReturnType<typeof createClient>,
  booking: any,
  warnings: string[]
): Promise<{ warning?: string }> {
  const bookingId = booking?.id ? String(booking.id) : null;
  const serviceType = String(booking?.service_type ?? booking?.serviceType ?? "").toLowerCase();
  const vendorId = booking?.vendor_id ? String(booking.vendor_id) : null;

  // STEP5E_CALL_SITE: Emergency fee wallet split (idempotent, completion-only)
  await step5eBestEffortEmergencyWalletSplit(supabase, booking, warnings);

  // 1) Apply platform/company cut (driver wallet deduction)
  if (bookingId) {
    try {
      const r: any = await supabase.rpc("process_booking_wallet_cut", {
        p_booking_id: bookingId,
      });
      if (r?.error) warnings.push("WALLET_CUT_RPC_ERROR: " + r.error.message);
    } catch (e: any) {
      warnings.push("WALLET_CUT_RPC_ERROR: " + String(e?.message || e));
    }
  } else {
    warnings.push("WALLET_CUT_SKIPPED_NO_BOOKING_ID");
  }

  // 2) Vendor wallet for takeout only
  if (serviceType === "takeout" && vendorId) {
    try {
      const r: any = await supabase.rpc("sync_vendor_takeout_wallet", {
        v_vendor_id: vendorId,
      });
      if (r?.error) warnings.push("VENDOR_SYNC_RPC_ERROR: " + r.error.message);
    } catch (e: any) {
      warnings.push("VENDOR_SYNC_RPC_ERROR: " + String(e?.message || e));
    }
  }

  return warnings.length ? { warning: warnings.join("; ") } : {};
}
'@

Replace-Exact -Path $statusPath -Old $statusOldWallet -New $statusNewWallet -Label "bestEffortWalletSyncOnComplete"

$statusOldInsert = @'
  const booking: any = bk.data;
  const cur = norm(booking.status) || "requested";
  const allowedNext = NEXT[cur] ?? [];
  const hasDriver = !!booking.driver_id;
'@

$statusNewInsert = @'
  const booking: any = bk.data;
  const cur = norm(booking.status) || "requested";
  const allowedNext = NEXT[cur] ?? [];
  const hasDriver = !!booking.driver_id;

  const isAdminSecretRequest = !!(wantSecret && gotSecret && gotSecret === wantSecret);
  const requestDriverId = String(body?.driver_id ?? body?.driverId ?? "").trim();
  const requestDeviceId = String(body?.device_id ?? body?.deviceId ?? "").trim();

  if (!isAdminSecretRequest && isDriverDeviceLockAllowed(body)) {
    const lockRes = await ensureDriverDeviceLock(requestDriverId, requestDeviceId);
    if (!lockRes.ok) {
      return jsonErr(lockRes.code, lockRes.message, lockRes.status, lockRes.extra || {});
    }
  }

  if (!isAdminSecretRequest && requestDriverId) {
    const ownRes = await enforceDriverOwnsBooking(
      requestDriverId,
      booking_id ? String(booking_id).trim() : null,
      booking_code ? String(booking_code).trim() : null
    );
    if (!ownRes.ok) {
      return jsonErr(ownRes.code, ownRes.message, ownRes.status);
    }
  }
'@

Replace-Exact -Path $statusPath -Old $statusOldInsert -New $statusNewInsert -Label "POST driver lock + ownership guards"

Write-Host "[DONE] Patch applied."