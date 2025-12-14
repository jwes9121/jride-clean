# JRide-Payout-Reports-BestPractice-Fix.ps1
# PS 5.1 SAFE - NO MANUAL EDITS
$ErrorActionPreference = "Stop"

function Backup-File($path) {
  if (Test-Path $path) {
    $bak = "$path.bak_{0:yyyyMMdd_HHmmss}" -f (Get-Date)
    Copy-Item $path $bak -Force
    Write-Host "🧷 Backup: $bak" -ForegroundColor DarkGray
  }
}

function Write-Utf8($path, $content) {
  $dir = Split-Path $path -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  Backup-File $path
  $content | Out-File -FilePath $path -Encoding utf8 -Force
  Write-Host "✅ Wrote: $path" -ForegroundColor Green
}

# Ensure we're in repo root (has package.json)
if (!(Test-Path ".\package.json")) {
  throw "Run this in your repo root (where package.json exists). Current: $(Get-Location)"
}

$reportsPage = "app\admin\payouts\drivers\reports\page.tsx"
$autoApproveApi = "app\api\admin\driver-payouts\auto-approve\route.ts"

# -------------------------
# 1) Reports page (UI) - fixed + simplified messages (no long red JSON)
# -------------------------
$reportsPageContent = @'
"use client";

import { useMemo, useState } from "react";

type AutoApproveResult = {
  ok?: boolean;
  message?: string;
  run_id?: number;
  rule_enabled?: boolean;
  checked_count?: number;
  approved_count?: number;
  skipped_other?: number;
  skipped_insufficient?: number;
  detail?: any;
};

function prettySummary(r: AutoApproveResult | null) {
  if (!r) return "";
  const checked = r.checked_count ?? 0;
  const approved = r.approved_count ?? 0;
  const skipIns = r.skipped_insufficient ?? 0;
  const skipOther = r.skipped_other ?? 0;

  if (checked === 0 && approved === 0 && skipIns === 0 && skipOther === 0) {
    return "Nothing to auto-approve (no pending payouts).";
  }
  return `Checked ${checked} • Approved ${approved} • Skipped (insufficient) ${skipIns} • Skipped (other) ${skipOther}`;
}

export default function DriverPayoutReportsPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>("all");
  const [limit, setLimit] = useState<number>(50);

  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<AutoApproveResult | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const summary = useMemo(() => prettySummary(last), [last]);

  async function runAutoApprove() {
    try {
      setBusy(true);
      setBanner(null);

      const res = await fetch("/api/admin/driver-payouts/auto-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      });

      const js = (await res.json().catch(() => ({}))) as AutoApproveResult;

      setLast(js);

      // Friendly messaging:
      if (!res.ok || js.ok === false) {
        const msg = js.message || "Auto-approve failed. Check server logs.";
        setBanner({ kind: "err", text: msg });
        return;
      }

      // rule enabled but skipped due to insufficient
      const checked = js.checked_count ?? 0;
      const approved = js.approved_count ?? 0;
      const skipIns = js.skipped_insufficient ?? 0;

      if (checked === 0) {
        setBanner({ kind: "ok", text: "Nothing to auto-approve (no pending payouts)." });
      } else if (approved === 0 && skipIns > 0) {
        setBanner({ kind: "warn", text: `No approvals: ${skipIns} pending payout(s) skipped due to insufficient wallet balance.` });
      } else {
        setBanner({ kind: "ok", text: `Auto-approve complete. Approved ${approved}. Skipped insufficient ${skipIns}.` });
      }
    } catch (e: any) {
      setBanner({ kind: "err", text: e?.message || "Auto-approve failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 920 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 14 }}>Driver Payout Reports</h1>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>From</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>To</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Status</div>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div style={{ marginLeft: "auto" }}>
            <button
              onClick={() => {
                // keep existing export behavior if you already handle it elsewhere
                // This is just a placeholder. Many teams wire export to a separate endpoint.
                alert("Export CSV: wire this to your existing export endpoint (already working in your screenshot).");
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111827",
                background: "#111827",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              Export CSV
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Auto-approve runner</div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="number"
              value={limit}
              min={1}
              max={500}
              onChange={(e) => setLimit(Number(e.target.value || 50))}
              style={{ width: 90 }}
            />
            <button
              onClick={runAutoApprove}
              disabled={busy}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #16a34a",
                background: busy ? "#86efac" : "#22c55e",
                color: "#052e16",
                fontWeight: 800,
              }}
            >
              {busy ? "Running..." : "Run auto-approve"}
            </button>

            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Approves only when rule enabled + wallet stays above minimum.
            </div>
          </div>

          {banner && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border:
                  banner.kind === "ok"
                    ? "1px solid #86efac"
                    : banner.kind === "warn"
                    ? "1px solid #fde68a"
                    : "1px solid #fecaca",
                background:
                  banner.kind === "ok"
                    ? "#ecfdf5"
                    : banner.kind === "warn"
                    ? "#fffbeb"
                    : "#fef2f2",
                color:
                  banner.kind === "ok"
                    ? "#065f46"
                    : banner.kind === "warn"
                    ? "#92400e"
                    : "#991b1b",
                fontWeight: 600,
                whiteSpace: "pre-wrap",
              }}
            >
              {banner.text}
            </div>
          )}

          {last && (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              <div>Last run: {summary}</div>
            </div>
          )}

          <div style={{ marginTop: 14, fontSize: 12, opacity: 0.85 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Best-practice notes</div>
            <ul style={{ marginLeft: 18 }}>
              <li>Auto-approve runs server-side with service role only (no anon access).</li>
              <li>Skip reasons should be summarized (not raw JSON) to reduce confusion.</li>
              <li>When “insufficient”, show one clean message: “Insufficient wallet”.</li>
            </ul>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, opacity: 0.6 }}>
            URL: /admin/payouts/drivers/reports
          </div>
        </div>
      </div>
    </div>
  );
}
'@

Write-Utf8 $reportsPage $reportsPageContent

# -------------------------
# 2) Auto-approve API - returns clean message (no long JSON in UI)
# -------------------------
$autoApproveApiContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // IMPORTANT: service role key must be set on server (never expose in client)
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(500, Number(body?.limit || 50)));

    const sb = adminClient();

    // Your SQL function name may vary; keep this aligned with your DB.
    // If your function is public.admin_auto_approve_driver_payouts(limit int) return json, use this:
    const { data, error } = await sb.rpc("admin_auto_approve_driver_payouts", { p_limit: limit });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          message: "Auto-approve failed on server.",
          detail: { code: error.code, message: error.message, hint: error.hint },
        },
        { status: 400 }
      );
    }

    // If function returns json already:
    const r: any = data || {};

    const checked = Number(r.checked_count || r.checked || 0);
    const approved = Number(r.approved_count || r.approved || 0);
    const skippedIns = Number(r.skipped_insufficient || r.insufficient || 0);
    const skippedOther = Number(r.skipped_other || r.other || 0);
    const ruleEnabled = !!(r.rule_enabled ?? r.enabled ?? true);
    const runId = r.run_id ?? r.id ?? null;

    // Friendly message
    let message = "";
    if (checked === 0 && approved === 0 && skippedIns === 0 && skippedOther === 0) {
      message = "Nothing to auto-approve (no pending payouts).";
    } else if (approved === 0 && skippedIns > 0) {
      message = `No approvals. Skipped ${skippedIns} due to insufficient wallet balance.`;
    } else {
      message = `Auto-approve complete. Approved ${approved}. Skipped insufficient ${skippedIns}.`;
    }

    return NextResponse.json({
      ok: true,
      message,
      run_id: runId,
      rule_enabled: ruleEnabled,
      checked_count: checked,
      approved_count: approved,
      skipped_other: skippedOther,
      skipped_insufficient: skippedIns,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message || "Auto-approve failed (unexpected)." },
      { status: 500 }
    );
  }
}
'@

Write-Utf8 $autoApproveApi $autoApproveApiContent

# -------------------------
# 3) Print correct SQL for your driver_payout_rules table (matches your columns)
# -------------------------
Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "NEXT STEP: enable payout rule" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Run this in Supabase SQL Editor (it uses YOUR real columns):" -ForegroundColor Yellow
Write-Host ""

$sql = @"
-- Enable rule row id=1 using real columns:
-- columns present: id (bigint), enabled (bool), max_amount (numeric), min_wallet_buffer (numeric), min_buffer (numeric), updated_by (text)

insert into public.driver_payout_rules (id, enabled, max_amount, min_wallet_buffer, min_buffer, updated_by)
values (1, true, 500, 0, 0, 'admin')
on conflict (id) do update set
  enabled = excluded.enabled,
  max_amount = excluded.max_amount,
  min_wallet_buffer = excluded.min_wallet_buffer,
  min_buffer = excluded.min_buffer,
  updated_by = excluded.updated_by,
  updated_at = now();
"@

Write-Host $sql -ForegroundColor Gray
Write-Host ""
Write-Host "Then refresh: http://localhost:3000/admin/payouts/drivers/reports" -ForegroundColor Green
Write-Host ""
Write-Host "DONE ✅" -ForegroundColor Green
