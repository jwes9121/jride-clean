# PATCH-JRIDE_CONTROL_CENTER_OPS_DASHBOARD_V1.ps1
# Rebuilds app/admin/control-center/page.tsx into a full Admin Ops Dashboard (UI-only).
# - No schema assumptions
# - No Mapbox changes
# - Keeps verification pending count (existing endpoint)
# - Adds tiles for key admin pages (links + optional counts)
# - Creates backup

$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (!(Test-Path $path)) { throw "Missing file: $path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak.$ts"
  Copy-Item $path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$root = (Get-Location).Path
$target = Join-Path $root "app\admin\control-center\page.tsx"

Backup-File $target

$contents = @'
"use client";

import * as React from "react";

type AnyObj = Record<string, any>;

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Tile({
  title,
  desc,
  href,
  badge,
  disabled,
  right,
}: {
  title: string;
  desc?: string;
  href?: string;
  badge?: string | number | null;
  disabled?: boolean;
  right?: React.ReactNode;
}) {
  const body = (
    <div className={cn("rounded-2xl border border-black/10 p-4 bg-white", disabled && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {desc ? <div className="text-xs opacity-70 mt-1">{desc}</div> : null}
        </div>

        <div className="flex items-center gap-2">
          {badge !== null && badge !== undefined ? (
            <div className="rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-xs font-semibold">
              {badge}
            </div>
          ) : null}
          {right}
        </div>
      </div>

      {href ? (
        <div className="mt-3">
          <a
            href={href}
            className={cn(
              "inline-flex rounded-xl px-4 py-2 font-semibold border border-black/10",
              disabled ? "bg-slate-100 text-slate-500 pointer-events-none" : "hover:bg-black/5"
            )}
          >
            Open
          </a>
        </div>
      ) : null}
    </div>
  );

  return body;
}

async function safeJson(url: string): Promise<AnyObj | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok) return null;
    return j || null;
  } catch {
    return null;
  }
}

export default function AdminControlCenter() {
  const [role, setRole] = React.useState<string>("admin");
  const isDispatcher = role === "dispatcher";

  // counts
  const [loading, setLoading] = React.useState(true);
  const [msg, setMsg] = React.useState<string>("");

  const [pendingVerifications, setPendingVerifications] = React.useState<number>(0);

  // optional status indicators (UI only; we do not assume endpoints exist)
  const [lastRefresh, setLastRefresh] = React.useState<string>("");

  React.useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const r = (qs.get("role") || "admin").toLowerCase();
      setRole(r);
    } catch {
      setRole("admin");
    }
  }, []);

  async function load() {
    setLoading(true);
    setMsg("");

    try {
      // --- Verification pending count (known working endpoint)
      const j = await safeJson("/api/admin/verification/pending");
      if (j?.ok && Array.isArray(j.rows)) {
        setPendingVerifications(j.rows.length);
      } else {
        // Keep UI stable even if endpoint fails
        setPendingVerifications(0);
      }

      setLastRefresh(new Date().toLocaleString());
    } catch (e: any) {
      setMsg(e?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let alive = true;

    const safeLoad = () => {
      if (!alive) return;
      load();
    };

    // Initial load
    safeLoad();

    // Reload when tab becomes visible / user refocuses window
    const onFocus = () => safeLoad();
    const onVis = () => {
      if (document.visibilityState === "visible") safeLoad();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    // BroadcastChannel (verification updates)
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        bc = new BroadcastChannel("jride_verification");
        bc.onmessage = (ev: any) => {
          if (ev?.data?.type === "pending_changed") safeLoad();
        };
      }
    } catch {}

    // localStorage fallback (cross-tab)
    const onStorage = (e: StorageEvent) => {
      if (e.key === "jride_verification_pending_changed") safeLoad();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
      try {
        bc?.close();
      } catch {}
    };
  }, []);

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Admin Control Center</div>
            <div className="text-sm opacity-70 mt-1">
              Operations dashboard (counts are live). Role: {role}
              {lastRefresh ? <span className="ml-2">• Last refresh: {lastRefresh}</span> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Refresh
          </button>
        </div>

        {msg ? <div className="mt-4 text-sm text-amber-700">{msg}</div> : null}

        {/* ===== OPS / DISPATCH ===== */}
        <div className="mt-6">
          <div className="text-sm font-semibold mb-2">Operations</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile
              title="LiveTrips"
              desc="Live map + active trips monitoring."
              href="/admin/livetrips"
            />
            <Tile
              title="Dispatch"
              desc="Manual assign & trip actions dashboard."
              href="/admin/dispatch"
            />
            <Tile
              title="Passenger Ride"
              desc="Passenger booking UI (for quick checks)."
              href="/ride"
            />
          </div>
        </div>

        {/* ===== QUEUES ===== */}
        <div className="mt-8">
          <div className="text-sm font-semibold mb-2">Queues</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile
              title="Passenger Verifications (Admin)"
              desc="Approve / reject verification requests (final authority)."
              href="/admin/verification"
              badge={loading ? "-" : pendingVerifications}
              disabled={isDispatcher}
              right={
                isDispatcher ? (
                  <div className="text-xs rounded-full bg-slate-100 border border-black/10 px-2 py-1">
                    admin-only
                  </div>
                ) : null
              }
            />
            <Tile
              title="Passenger Verifications (Dispatcher)"
              desc="Read-only pre-screen queue view."
              href="/admin/dispatcher-verifications"
              badge={loading ? "-" : pendingVerifications}
            />
            <Tile
              title="Wallet Adjust"
              desc="Manual wallet adjustments / admin tools."
              href="/admin/wallet-adjust"
            />
          </div>
        </div>

        {/* ===== FINANCE ===== */}
        <div className="mt-8">
          <div className="text-sm font-semibold mb-2">Finance</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile
              title="Finance Summary"
              desc="High-level finance dashboards."
              href="/admin/finance/summary"
            />
            <Tile
              title="Driver Payouts"
              desc="Approve/track driver payout requests."
              href="/admin/driver-payouts"
            />
            <Tile
              title="Vendor Payouts"
              desc="Approve/track vendor payout requests."
              href="/admin/vendor-payouts"
            />
          </div>
          <div className="text-xs opacity-60 mt-2">
            Note: Some pages may be work-in-progress depending on your current branch.
          </div>
        </div>

        {/* ===== SYSTEM ===== */}
        <div className="mt-8">
          <div className="text-sm font-semibold mb-2">System</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile
              title="Admin Profile / Auth Check"
              desc="Quick auth sanity checks."
              href="/api/auth/session"
            />
            <Tile
              title="Verification API (pending)"
              desc="Raw JSON view (debug)."
              href="/api/admin/verification/pending"
            />
            <Tile
              title="Notes"
              desc="Dispatcher gating is still UI-only until we enforce server checks in decide route."
              badge={null}
            />
          </div>
        </div>

        {isDispatcher ? (
          <div className="mt-8 text-xs text-slate-600">
            Dispatcher mode: Admin approve/reject tiles are disabled here (UI). Next step is server enforcement in decide route.
          </div>
        ) : null}
      </div>
    </main>
  );
}
'@

Set-Content -Path $target -Value $contents -Encoding UTF8
Write-Host "[DONE] Replaced: $target"
Write-Host ""
Write-Host "[NEXT] Run: npm run build"
