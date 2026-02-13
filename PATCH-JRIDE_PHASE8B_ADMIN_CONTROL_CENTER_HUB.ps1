# PATCH-JRIDE_PHASE8B_ADMIN_CONTROL_CENTER_HUB.ps1
# Phase 8B: Admin Control Center (single hub page with buttons/links)
# SAFE:
# - UI only
# - No backend changes
# - No wallet/payout mutations
# - No Mapbox/LiveTrips edits (links only)

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
$dir  = Join-Path $root "app\admin\control-center"
$file = Join-Path $dir  "page.tsx"

if (!(Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Path $dir | Out-Null
  Ok "[OK] Created dir: $dir"
}

# Backup if exists
if (Test-Path -LiteralPath $file) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$file.bak.$ts"
  Copy-Item -LiteralPath $file -Destination $bak -Force
  Ok "[OK] Backup: $bak"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$tsx = @'
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Item = {
  title: string;
  desc: string;
  href: string;
  tags: string[];
};

function norm(s: string) { return (s || "").toLowerCase().trim(); }

export default function AdminControlCenterPage() {
  const [q, setQ] = useState("");

  const items: Item[] = useMemo(() => ([
    {
      title: "Live Trips (Dispatch / Tracking)",
      desc: "Live operations view. Link only (no embedding) to avoid regressions.",
      href: "/admin/livetrips",
      tags: ["livetrips", "map", "dispatch", "tracking"],
    },
    {
      title: "Driver Payouts",
      desc: "Admin payouts UI (use existing backend endpoints).",
      href: "/admin/driver-payouts",
      tags: ["driver", "payouts", "wallet", "cashout"],
    },
    {
      title: "Vendor Payouts",
      desc: "Vendor payout requests & mark-paid flow (read-only wallet rule honored).",
      href: "/admin/vendor-payouts",
      tags: ["vendor", "payouts", "takeout"],
    },
    {
      title: "Vendor Payouts Report (Read-only)",
      desc: "Monthly / summary payout reporting for vendors (read-only).",
      href: "/admin/vendor-payouts-summary",
      tags: ["vendor", "report", "monthly", "summary"],
    },
    {
      title: "LGU / Accounting Exports (Read-only)",
      desc: "Vendor + driver exports + CSV (read-only).",
      href: "/admin/reports/lgu",
      tags: ["lgu", "exports", "csv", "accounting", "reports"],
    },
  ]), []);

  const filtered = useMemo(() => {
    const qq = norm(q);
    if (!qq) return items;
    return items.filter(it => {
      const hay = norm([it.title, it.desc, it.href, it.tags.join(" ")].join(" "));
      return hay.includes(qq);
    });
  }, [q, items]);

  const card: any = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    background: "white",
    maxWidth: 620,
  };

  const btn: any = {
    display: "inline-block",
    padding: "8px 10px",
    border: "1px solid #ddd",
    borderRadius: 10,
    background: "white",
    fontSize: 12,
    textDecoration: "none",
  };

  const tag: any = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #eee",
    fontSize: 11,
    opacity: 0.75,
    marginRight: 6,
    marginTop: 6,
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Admin Control Center</h1>
      <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12 }}>
        One-page hub with links. Safe: UI-only. No wallet mutations. No payout actions executed here.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 12 }}>
          Search:&nbsp;
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="type keywords..."
            style={{ width: 320 }}
          />
        </label>

        <a href="/admin" style={btn}>/admin</a>
        <a href="/admin/control-center" style={btn}>/admin/control-center</a>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        {filtered.map((it) => (
          <div key={it.href} style={card}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{it.title}</div>
            <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>{it.desc}</div>

            <div style={{ marginTop: 10 }}>
              {it.tags.map(t => <span key={t} style={tag}>{t}</span>)}
            </div>

            <div style={{ marginTop: 12 }}>
              <Link href={it.href} style={btn}>Open</Link>
              <span style={{ marginLeft: 10, fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>
                {it.href}
              </span>
            </div>
          </div>
        ))}

        {filtered.length === 0 ? (
          <div style={{ opacity: 0.7, fontSize: 13 }}>No matches.</div>
        ) : null}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
        Locked rule: this page is navigation only. It does not call admin APIs and does not modify any state.
      </div>
    </div>
  );
}
'@

[System.IO.File]::WriteAllText($file, $tsx, $utf8NoBom)

Ok "[DONE] Phase 8B Admin Control Center created."
Ok "Open: /admin/control-center"
