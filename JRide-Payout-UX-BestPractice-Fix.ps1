# JRide-Payout-UX-BestPractice-Fix.ps1
# PS5.1 SAFE (NO Get-Content -Raw). NO MANUAL EDITS.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Ok($m){ Write-Host "✅ $m" -ForegroundColor Green }
function Warn($m){ Write-Host "⚠️ $m" -ForegroundColor Yellow }

function ReadAllText([string]$path) {
  if (!(Test-Path $path)) { return $null }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function WriteAllTextUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $dir = Split-Path $path -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Backup-File([string]$path) {
  if (!(Test-Path $path)) { return }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$path.bak_$stamp"
  Copy-Item -Force $path $bak
  Write-Host "📦 Backup: $bak" -ForegroundColor DarkGray
}

function Find-FilesContaining([string]$root, [string]$needle) {
  $results = @()
  Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".ts",".tsx" } |
    ForEach-Object {
      $p = $_.FullName
      try {
        $t = ReadAllText $p
        if ($t -and $t.Contains($needle)) { $results += $p }
      } catch { }
    }
  return $results
}

function Ensure-AdminReportsPage() {
  $path = Join-Path $PWD "app\admin\payouts\drivers\reports\page.tsx"
  if (!(Test-Path $path)) {
    Warn "Admin reports page not found at: $path (skipping)"
    return
  }

  Backup-File $path

  # This page is intentionally "self-contained" so we stop breaking it with tiny patches.
  $full = @'
"use client";

import React, { useMemo, useState } from "react";

type RunResult = {
  run_id?: number;
  rule_enabled?: boolean;
  checked_count?: number;
  skipped_other?: number;
  approved_count?: number;
  skipped_insufficient?: number;
  message?: string;
};

function normalizeAutoApproveMessage(payload: any): { kind: "ok" | "warn" | "err"; text: string; raw?: string } {
  // payload can be: { ok:true, result:{...} } OR { error:"..." } OR raw object
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? {}, null, 0);

  const r: RunResult =
    payload?.result ??
    payload ??
    {};

  // If server already gave a clean message, use it.
  if (typeof r?.message === "string" && r.message.trim().length > 0) {
    return { kind: "ok", text: r.message.trim(), raw };
  }

  const checked = Number(r.checked_count ?? 0);
  const approved = Number(r.approved_count ?? 0);
  const insuff = Number(r.skipped_insufficient ?? 0);

  if (checked === 0) {
    return { kind: "ok", text: "Nothing to auto-approve (no pending payouts).", raw };
  }

  if (approved > 0) {
    return { kind: "ok", text: `Auto-approve finished: approved ${approved}, skipped (insufficient) ${insuff}.`, raw };
  }

  if (insuff > 0) {
    return { kind: "warn", text: `No payouts approved. Skipped ${insuff} due to insufficient wallet after payout.`, raw };
  }

  return { kind: "warn", text: "Auto-approve finished. No payouts approved.", raw };
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg =
      (data && (data.message || data.error)) ||
      `Request failed (${res.status})`;
    const err: any = new Error(msg);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

export default function DriverPayoutReportsPage() {
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>("all");
  const [limit, setLimit] = useState<number>(50);

  const [busy, setBusy] = useState(false);
  const [lastMsg, setLastMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string; raw?: string } | null>(null);

  const exportUrl = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("from", from);
    qs.set("to", to);
    if (status && status !== "all") qs.set("status", status);
    return `/api/admin/driver-payouts/export?${qs.toString()}`;
  }, [from, to, status]);

  async function runAutoApprove() {
    setBusy(true);
    setLastMsg(null);
    try {
      const data = await postJson("/api/admin/driver-payouts/auto-approve", { limit });
      const msg = normalizeAutoApproveMessage(data);
      setLastMsg(msg);
    } catch (e: any) {
      // Clean, single message. (No long JSON dump.)
      const text = (e?.message || "Auto-approve failed.").toString();
      setLastMsg({ kind: "err", text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Driver Payout Reports</h1>

      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginBottom: 14 }}>
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
          <a href={exportUrl}>
            <button style={{ padding: "10px 16px", fontWeight: 700 }}>Export CSV</button>
          </a>
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Auto-approve runner</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            style={{ width: 90 }}
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value || "50", 10))}
          />
          <button
            onClick={runAutoApprove}
            disabled={busy}
            style={{ padding: "10px 14px", fontWeight: 800 }}
          >
            {busy ? "Running..." : "Run auto-approve"}
          </button>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Approves only when rule enabled + wallet stays above minimum.
          </div>
        </div>

        {lastMsg && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              border: "1px solid #ddd",
              background:
                lastMsg.kind === "err" ? "#ffecec" : lastMsg.kind === "warn" ? "#fff8e6" : "#eefaf1",
              color: "#111",
              fontWeight: 600,
            }}
          >
            {lastMsg.text}
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700 }}>Best-practice notes</div>
          <ul style={{ marginTop: 6 }}>
            <li>Auto-approve runs server-side with service role only (no anon access).</li>
            <li>Skip reasons are summarized (not raw JSON) to reduce confusion.</li>
            <li>When insufficient, show one clean message: “Insufficient wallet”.</li>
          </ul>
        </div>

        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.65 }}>
          URL: /admin/payouts/drivers/reports
        </div>
      </div>
    </div>
  );
}
'@

  WriteAllTextUtf8NoBom $path $full
  Ok "Admin reports page rewritten cleanly: $path"
}

function Patch-DriverRequestPayoutUX() {
  Info "Scanning for driver_request_payout usage..."
  $hits = Find-FilesContaining $PWD "driver_request_payout"
  if ($hits.Count -eq 0) {
    Warn "No file found containing 'driver_request_payout'. Skipping driver UX patch."
    return
  }

  $target = $hits[0]
  Backup-File $target

  $src = ReadAllText $target
  if (-not $src) { Warn "Could not read $target"; return }

  # We patch by injecting a safe error normalizer and replacing common alert(error) / toast(error) patterns.
  if ($src -notmatch "function\s+normalizePayoutError") {
    $inject = @'

function normalizePayoutError(e: any): string {
  // Handle Supabase/PostgREST error shapes + our custom RAISE EXCEPTION (P0001) messages.
  const msg =
    (e && (e.message || e.error_description || e.error)) ||
    (e && e.data && (e.data.message || e.data.error)) ||
    "";

  const text = String(msg || "").trim();

  // Common “insufficient wallet” cases (your DB raises: "Insufficient wallet for payout...")
  if (/insufficient wallet/i.test(text)) {
    return "Insufficient wallet. Your balance must stay above the minimum after payout.";
  }

  // PostgREST message wrapper case: {"message":"..."}
  try {
    const j = JSON.parse(text);
    if (j && typeof j.message === "string") {
      if (/insufficient wallet/i.test(j.message)) {
        return "Insufficient wallet. Your balance must stay above the minimum after payout.";
      }
      return j.message;
    }
  } catch {}

  // Fallback short message
  return text.length > 0 ? text : "Request failed. Please try again.";
}

'@

    # Put helper near top (after imports)
    $src = $src -replace "(?s)(import[\s\S]*?;\s*)", "`$1`n$inject"
  }

  # Replace patterns: alert(error.message) / alert(JSON.stringify(error)) / setError(...)
  # We keep it conservative: only swap common alert(...) occurrences.
  $src = $src -replace "alert\(\s*error\.message\s*\)", "alert(normalizePayoutError(error))"
  $src = $src -replace "alert\(\s*JSON\.stringify\(\s*error\s*\)\s*\)", "alert(normalizePayoutError(error))"
  $src = $src -replace "toast\.error\(\s*error\.message\s*\)", "toast.error(normalizePayoutError(error))"
  $src = $src -replace "toast\.error\(\s*JSON\.stringify\(\s*error\s*\)\s*\)", "toast.error(normalizePayoutError(error))"

  # Also handle: if (error) throw error;  -> throw new Error(normalizePayoutError(error))
  $src = $src -replace "throw\s+error\s*;", "throw new Error(normalizePayoutError(error));"

  WriteAllTextUtf8NoBom $target $src
  Ok "Driver payout request UX patched (clean 'Insufficient wallet' message): $target"
}

Info "JRide Payout UX Best Practice Fix (NO PARTIALS)"
Info "Repo: $PWD"
Info ""

Ensure-AdminReportsPage
Patch-DriverRequestPayoutUX

Info ""
Ok "Done. Now restart dev server if it's running:"
Write-Host "   Ctrl+C then: npm run dev" -ForegroundColor Green
Write-Host ""
Write-Host "Test:" -ForegroundColor Cyan
Write-Host "  1) http://localhost:3000/admin/payouts/drivers/reports" -ForegroundColor Cyan
Write-Host "  2) Trigger a payout request with low wallet -> should show 'Insufficient wallet' (single OK) " -ForegroundColor Cyan
