param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE Patch: driver eligibility truth + verify image shrink (V1 / PS5-safe) =="
Write-Host "Root: $ProjRoot"

function Read-TextUtf8 {
  param([Parameter(Mandatory=$true)][string]$Path)
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-TextUtf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and !(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
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

$routePath = Join-Path $ProjRoot "app\api\admin\livetrips\drivers-summary\route.ts"
$verifyPagePath = Join-Path $ProjRoot "app\verify\page.tsx"

Backup-File -Path $routePath -Tag "DRIVER_ELIGIBILITY_AND_VERIFY_IMAGE_SHRINK_V1"
Backup-File -Path $verifyPagePath -Tag "DRIVER_ELIGIBILITY_AND_VERIFY_IMAGE_SHRINK_V1"

$routeContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ok(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function s(v: any): string {
  return String(v ?? "");
}

function formatPH(input?: string | null) {
  if (!input) return null;
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) return input;
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

function ageSeconds(input?: string | null) {
  if (!input) return null;
  const ms = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 1000));
}

function activeBookingBlocksAssign(activeBookingStatus: string) {
  return [
    "assigned",
    "accepted",
    "fare_proposed",
    "on_the_way",
    "arrived",
    "enroute",
    "on_trip",
  ].includes(activeBookingStatus);
}

function eligibilityReason(row: any) {
  const rawStatus = s(row?.status).trim().toLowerCase();
  const effectiveStatus = s(row?.effective_status).trim().toLowerCase();
  const activeBookingStatus = s(row?.active_booking_status).trim().toLowerCase();

  if (activeBookingStatus === "on_trip" || activeBookingStatus === "enroute") return "on trip";
  if (
    activeBookingStatus === "assigned" ||
    activeBookingStatus === "accepted" ||
    activeBookingStatus === "on_the_way" ||
    activeBookingStatus === "arrived" ||
    activeBookingStatus === "fare_proposed"
  ) {
    return effectiveStatus === "stale" ? "assigned booking and stale heartbeat" : "assigned booking";
  }
  if (row?.assign_eligible === true) return "eligible now";
  if (effectiveStatus === "stale") return "stale heartbeat";
  if (rawStatus === "offline" || rawStatus === "logout" || rawStatus === "logged_out") return "offline";
  if (!row?.assign_online_eligible) return "not online eligible";
  if (!row?.assign_fresh) return "not fresh";
  return "not eligible";
}

export async function GET() {
  try {
    const sbUrl =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";

    const sbServiceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "";

    if (!sbUrl || !sbServiceKey) {
      return bad("Missing service-role env", "MISSING_SERVICE_ROLE_ENV", 500, {
        has_SUPABASE_URL: Boolean(sbUrl),
        has_SUPABASE_SERVICE_ROLE_KEY: Boolean(sbServiceKey),
      });
    }

    const supabase = createClient(sbUrl, sbServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const staleAfterSeconds = 120;
    const assignCutoffMinutes = Number(process.env.JRIDE_DRIVER_FRESH_MINUTES || "10");
    const assignCutoffSeconds = assignCutoffMinutes * 60;
    const onlineLike = new Set(["online", "available", "idle", "waiting"]);
    const activeStatuses = new Set(["assigned", "accepted", "fare_proposed", "on_the_way", "arrived", "enroute", "on_trip"]);

    const locRes = await supabase
      .from("driver_locations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1000);

    if (locRes.error) {
      return bad("driver_locations query failed", "DRIVER_LOCATIONS_QUERY_FAILED", 500, {
        details: locRes.error.message,
      });
    }

    const latestByDriver = new Map<string, any>();
    for (const row of (locRes.data || []) as any[]) {
      const did = s(row?.driver_id).trim();
      if (!did) continue;
      if (!latestByDriver.has(did)) latestByDriver.set(did, row);
    }

    const ids = Array.from(latestByDriver.keys());
    if (!ids.length) {
      return ok({
        ok: true,
        count: 0,
        stale_after_seconds: staleAfterSeconds,
        assign_cutoff_minutes: assignCutoffMinutes,
        drivers: [],
      });
    }

    const profRes = await supabase
      .from("driver_profiles")
      .select("driver_id, full_name, municipality")
      .in("driver_id", ids);

    if (profRes.error) {
      return bad("driver_profiles query failed", "DRIVER_PROFILES_QUERY_FAILED", 500, {
        details: profRes.error.message,
      });
    }

    const profileByDriver = new Map<string, any>();
    for (const row of (profRes.data || []) as any[]) {
      const did = s(row?.driver_id).trim();
      if (did) profileByDriver.set(did, row);
    }

    const bookingsByDriverRes = await supabase
      .from("bookings")
      .select("id, booking_code, driver_id, assigned_driver_id, status, town, created_at, updated_at")
      .in("driver_id", ids)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (bookingsByDriverRes.error) {
      return bad("bookings(driver_id) query failed", "BOOKINGS_BY_DRIVER_QUERY_FAILED", 500, {
        details: bookingsByDriverRes.error.message,
      });
    }

    const bookingsByAssignedRes = await supabase
      .from("bookings")
      .select("id, booking_code, driver_id, assigned_driver_id, status, town, created_at, updated_at")
      .in("assigned_driver_id", ids)
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (bookingsByAssignedRes.error) {
      return bad("bookings(assigned_driver_id) query failed", "BOOKINGS_BY_ASSIGNED_QUERY_FAILED", 500, {
        details: bookingsByAssignedRes.error.message,
      });
    }

    const bookingMap = new Map<string, any>();
    for (const row of ([] as any[]).concat(bookingsByDriverRes.data || [], bookingsByAssignedRes.data || [])) {
      const bid = s(row?.id).trim();
      if (!bid) continue;
      if (!bookingMap.has(bid)) bookingMap.set(bid, row);
    }

    const countsByDriver = new Map<string, {
      completed: number;
      cancelled: number;
      activeBooking: any | null;
    }>();

    function touchDriver(did: string) {
      if (!countsByDriver.has(did)) {
        countsByDriver.set(did, {
          completed: 0,
          cancelled: 0,
          activeBooking: null,
        });
      }
      return countsByDriver.get(did)!;
    }

    for (const row of bookingMap.values()) {
      const st = s(row?.status).trim().toLowerCase();
      const did1 = s(row?.driver_id).trim();
      const did2 = s(row?.assigned_driver_id).trim();

      const related = Array.from(new Set([did1, did2].filter(Boolean)));
      for (const did of related) {
        const entry = touchDriver(did);

        if (st === "completed") entry.completed += 1;
        if (st === "cancelled") entry.cancelled += 1;

        if (activeStatuses.has(st)) {
          const currentTs = new Date(s(entry.activeBooking?.updated_at || entry.activeBooking?.created_at || 0)).getTime();
          const rowTs = new Date(s(row?.updated_at || row?.created_at || 0)).getTime();
          if (!entry.activeBooking || rowTs > currentTs) {
            entry.activeBooking = row;
          }
        }
      }
    }

    const drivers = ids.map((did) => {
      const loc = latestByDriver.get(did) || {};
      const prof = profileByDriver.get(did) || {};
      const counts = countsByDriver.get(did) || { completed: 0, cancelled: 0, activeBooking: null };

      const updatedAt = loc?.updated_at ?? null;
      const age = ageSeconds(updatedAt);
      const rawStatus = s(loc?.status).trim().toLowerCase();
      const isStale = age == null ? true : age > staleAfterSeconds;
      const effectiveStatus = isStale ? "stale" : rawStatus;
      const assignFresh = age == null ? false : age <= assignCutoffSeconds;
      const assignOnlineEligible = onlineLike.has(rawStatus);
      const activeBookingStatus = s(counts.activeBooking?.status).trim().toLowerCase();
      const blockedByActiveBooking = activeBookingBlocksAssign(activeBookingStatus);
      const assignEligible = assignFresh && assignOnlineEligible && !blockedByActiveBooking;

      const row: any = {
        id: loc?.id ?? null,
        driver_id: did,
        full_name: prof?.full_name ?? null,
        municipality: prof?.municipality ?? null,
        town: loc?.town ?? null,
        home_town: loc?.home_town ?? prof?.municipality ?? null,
        zone: loc?.town ?? loc?.home_town ?? prof?.municipality ?? null,
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
        status: loc?.status ?? null,
        effective_status: effectiveStatus,
        updated_at: updatedAt,
        updated_at_ph: formatPH(updatedAt),
        created_at: null,
        created_at_ph: null,
        age_seconds: age,
        is_stale: isStale,
        assign_cutoff_minutes: assignCutoffMinutes,
        assign_fresh: assignFresh,
        assign_online_eligible: assignOnlineEligible,
        assign_eligible: assignEligible,
        vehicle_type: loc?.vehicle_type ?? null,
        capacity: loc?.capacity ?? null,
        completed_trips_count: counts.completed,
        cancelled_trips_count: counts.cancelled,
        active_booking_id: counts.activeBooking?.id ?? null,
        active_booking_code: counts.activeBooking?.booking_code ?? null,
        active_booking_status: counts.activeBooking?.status ?? null,
        active_booking_town: counts.activeBooking?.town ?? null,
        active_booking_updated_at: counts.activeBooking?.updated_at ?? counts.activeBooking?.created_at ?? null,
      };

      row.eligibility_reason = eligibilityReason(row);
      return row;
    });

    return ok({
      ok: true,
      count: drivers.length,
      stale_after_seconds: staleAfterSeconds,
      assign_cutoff_minutes: assignCutoffMinutes,
      drivers,
    });
  } catch (e: any) {
    return bad("Unexpected drivers-summary error", "DRIVERS_SUMMARY_UNEXPECTED", 500, {
      details: String(e?.message || e),
    });
  }
}
'@

$verifyPageContent = @'
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type VerifyRequest = {
  passenger_id?: string;
  full_name?: string | null;
  town?: string | null;
  status?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  admin_notes?: string | null;
  id_front_path?: string | null;
  selfie_with_id_path?: string | null;
};

function s(v: any) {
  return String(v ?? "");
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

async function shrinkImageFile(file: File, maxWidth = 1400, maxHeight = 1400, quality = 0.72): Promise<File> {
  const type = (file.type || "").toLowerCase();
  if (!type.startsWith("image/")) return file;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error || new Error("FileReader failed"));
    fr.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Image decode failed"));
    el.src = dataUrl;
  });

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (!width || !height) return file;

  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, targetW, targetH);

  const outType = "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), outType, quality);
  });

  if (!blob) return file;

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.jpg`, {
    type: outType,
    lastModified: Date.now(),
  });
}

export default function VerifyPage() {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("unknown");
  const [reqData, setReqData] = useState<VerifyRequest | null>(null);

  const [fullName, setFullName] = useState("");
  const [town, setTown] = useState("");
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    setError("");
    try {
      const res = await fetchWithTimeout(`/api/public/passenger/verification/request?passenger_id=${encodeURIComponent(userId)}`, {}, 30000);
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || j?.ok === false) {
        throw new Error(s(j?.error || j?.message || `HTTP ${res.status}`));
      }

      const row = (j?.request || null) as VerifyRequest | null;
      setReqData(row);
      setStatus(s(row?.status || "not_submitted"));

      if (row?.full_name) setFullName(s(row.full_name));
      if (row?.town) setTown(s(row.town));
    } catch (e: any) {
      setError(s(e?.message || "Failed to load verification request."));
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetchWithTimeout("/api/verify/session-user", {}, 30000);
        const j: any = await res.json().catch(() => ({}));
        const uid = s(j?.userId || j?.user_id || "");
        if (!mounted) return;
        setUserId(uid);
      } catch {
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (userId) refresh();
  }, [userId, refresh]);

  const canSubmit = useMemo(() => {
    return !!userId && !!fullName.trim() && !!town.trim() && !!idFrontFile && !!selfieFile && !loading;
  }, [userId, fullName, town, idFrontFile, selfieFile, loading]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      if (!userId) throw new Error("User session missing.");
      if (!fullName.trim()) throw new Error("Full name required.");
      if (!town.trim()) throw new Error("Town required.");
      if (!idFrontFile) throw new Error("ID front photo required.");
      if (!selfieFile) throw new Error("Selfie holding ID required.");

      setMessage("Compressing images before upload...");

      const shrunkIdFront = await shrinkImageFile(idFrontFile, 1400, 1400, 0.72);
      const shrunkSelfie = await shrinkImageFile(selfieFile, 1400, 1400, 0.72);

      setMessage(
        `Uploading compressed files: ID ${Math.round(shrunkIdFront.size / 1024)} KB, Selfie ${Math.round(shrunkSelfie.size / 1024)} KB...`
      );

      const fd = new FormData();
      fd.append("full_name", fullName.trim());
      fd.append("town", town.trim());
      fd.append("id_front", shrunkIdFront);
      fd.append("selfie_with_id", shrunkSelfie);

      const res = await fetchWithTimeout(
        "/api/public/passenger/verification/request",
        {
          method: "POST",
          body: fd,
        },
        120000
      );

      const rawText = await res.text().catch(() => "");
      let j: any = null;

      try {
        j = rawText ? JSON.parse(rawText) : null;
      } catch {
        j = null;
      }

      if (!res.ok || !j?.ok) {
        const parts: string[] = [];

        if (!res.ok) {
          parts.push("HTTP " + String(res.status));
        }

        if (j?.error) {
          parts.push(String(j.error));
        } else if (j?.message) {
          parts.push(String(j.message));
        } else if (rawText) {
          parts.push(rawText);
        } else {
          parts.push("Empty or non-JSON response from verification API");
        }

        if (j?.hint) {
          parts.push("Hint: " + String(j.hint));
        }

        setError(parts.join(" | "));
        setMessage("");
        return;
      }

      setMessage(String(j?.message || "Submitted. Please wait for review."));
      await refresh();
    } catch (e: any) {
      const msg = s(e?.message || "");
      if (msg.toLowerCase().includes("aborted")) {
        setError("Submit timed out. Please try again.");
      } else {
        setError(msg || "Submit failed.");
      }
      setMessage("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Passenger Verification</h1>
          <p className="mt-2 text-gray-700">Upload your ID details so JRide can verify you.</p>
        </div>
        <button
          type="button"
          className="rounded border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={() => refresh()}
          disabled={refreshing || !userId}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="mb-4 rounded border bg-white p-4">
        <div className="text-sm text-gray-700">User ID (UUID)</div>
        <div className="mt-1 text-2xl font-semibold tracking-wide">{userId || "-"}</div>
        <div className="mt-4 text-sm">
          Current status: <span className="font-semibold">{status || "unknown"}</span>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-4 text-blue-700">
          {message}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="rounded border bg-white p-4">
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium">Full name</label>
          <input
            className="w-full rounded border px-3 py-2"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
          />
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium">Town</label>
          <input
            className="w-full rounded border px-3 py-2"
            value={town}
            onChange={(e) => setTown(e.target.value)}
            placeholder="Town"
          />
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium">ID front photo</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setIdFrontFile(e.target.files?.[0] || null)}
          />
          {idFrontFile ? (
            <div className="mt-2 text-xs text-gray-500">
              Original size: {Math.round(idFrontFile.size / 1024)} KB
            </div>
          ) : null}
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium">Selfie holding ID</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setSelfieFile(e.target.files?.[0] || null)}
          />
          {selfieFile ? (
            <div className="mt-2 text-xs text-gray-500">
              Original size: {Math.round(selfieFile.size / 1024)} KB
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          className="rounded bg-black px-5 py-3 text-white disabled:opacity-50"
          disabled={!canSubmit}
        >
          {loading ? "Submitting..." : "Submit for verification"}
        </button>
      </form>
    </div>
  );
}
'@

Write-TextUtf8NoBom -Path $routePath -Content $routeContent
Write-Host "[OK] Replaced: app/api/admin/livetrips/drivers-summary/route.ts"

Write-TextUtf8NoBom -Path $verifyPagePath -Content $verifyPageContent
Write-Host "[OK] Replaced: app/verify/page.tsx"

Write-Host "[DONE] Patch applied."