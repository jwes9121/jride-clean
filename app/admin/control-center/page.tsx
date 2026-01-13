"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Item = {
  title: string;
  desc: string;
  href: string;
};

type Section = {
  heading: string;
  items: Item[];
};

type Role = "admin" | "dispatcher";

function safeNormRole(v: any): Role | null {
  const s = String(v || "").toLowerCase().trim();
  if (s === "admin") return "admin";
  if (s === "dispatcher") return "dispatcher";
  return null;
}

function getRoleFromClient(): { role: Role; debug: boolean; source: string } {
  if (typeof window === "undefined") return { role: "admin", debug: false, source: "default" };

  const sp = new URLSearchParams(window.location.search);
  const debug = sp.get("debug") === "1";

  // 1) Explicit query param override (most reliable, no API calls)
  const qpRole = safeNormRole(sp.get("role"));
  if (qpRole) return { role: qpRole, debug, source: "query" };

  // 2) Local storage hint (UI-only)
  try {
    const ls = safeNormRole(window.localStorage.getItem("jride_role"));
    if (ls) return { role: ls, debug, source: "localStorage" };
  } catch {
    // ignore
  }

  // 3) Default: admin
  return { role: "admin", debug, source: "default" };
}

export default function AdminControlCenterPage() {
  const [role, setRole] = useState<Role>("admin");
  const [debug, setDebug] = useState(false);
  const [roleSource, setRoleSource] = useState<string>("default");

  useEffect(() => {
    const r = getRoleFromClient();
    setRole(r.role);
    setDebug(r.debug);
    setRoleSource(r.source);
  }, []);

  const sections: Section[] = useMemo(
    () => [
      {
        heading: "Core Admin",
        items: [
          {
            title: "Live Trips",
            desc: "Real-time dispatch and tracking view (navigation only).",
            href: "/admin/livetrips",
          },
          {
            title: "At-Risk Trips (SLA)",
            desc: "Trips nearing or breaching SLA thresholds (read-only).",
            href: "/admin/trips/at-risk",
          },
          {
            title: "Driver Payouts",
            desc: "Driver payout records and status overview.",
            href: "/admin/driver-payouts",
          },
          {
            title: "Vendor Payouts",
            desc: "Vendor payout records and request list.",
            href: "/admin/vendor-payouts",
          },
          {
            title: "Vendor Payout Summary",
            desc: "Read-only payout summaries per vendor.",
            href: "/admin/vendor-payouts-summary",
          },
          {
            title: "LGU / Accounting Exports",
            desc: "Accounting and LGU export views (CSV-ready, read-only).",
            href: "/admin/reports/lgu",
          },
        ],
      },

      {
        heading: "Reports",
        items: [
          {
            title: "Vendor Monthly Report",
            desc: "Monthly vendor performance and revenue summary.",
            href: "/admin/reports/vendor-monthly",
          },
          {
            title: "Vendor Summary Report",
            desc: "Overall vendor statistics and aggregates.",
            href: "/admin/reports/vendor-summary",
          },
          {
            title: "Driver Payout Requests (LGU View)",
            desc: "LGU-safe view of driver payout requests.",
            href: "/admin/reports/driver-payout-requests",
          },
        ],
      },

      {
        heading: "Quality / Operations",
        items: [
          {
            title: "Stuck Drivers",
            desc: "Drivers flagged for inactivity or stalled trips.",
            href: "/admin/ops/stuck-drivers",
          },
          {
            title: "Auto-Assign Monitor",
            desc: "Read-only monitoring of auto-assign behavior.",
            href: "/admin/ops/auto-assign-monitor",
          },
          {
            title: "Wallet Reconciliation",
            desc: "Read-only wallet balance and reconciliation status.",
            href: "/admin/ops/wallet-reconciliation",
          },
        ],
      },
    ],
    []
  );

  // Dispatcher is ops-only + live visibility
  const dispatcherAllow = useMemo(() => {
    return new Set<string>([
      "/admin/livetrips",
      "/admin/trips/at-risk",
      "/admin/ops/stuck-drivers",
      "/admin/ops/auto-assign-monitor",
      // Intentionally NOT allowed for dispatcher:
      // payouts, exports, reports, wallet reconciliation
    ]);
  }, []);

  const visibleSections = useMemo(() => {
    if (role === "admin") return sections;

    // dispatcher
    const filtered: Section[] = [];
    for (const s of sections) {
      const items = s.items.filter((it) => dispatcherAllow.has(it.href));
      if (items.length) filtered.push({ ...s, items });
    }
    return filtered;
  }, [role, sections, dispatcherAllow]);

  function setRoleHint(nextRole: Role) {
    setRole(nextRole);
    setRoleSource("localStorage");
    try {
      window.localStorage.setItem("jride_role", nextRole);
    } catch {
      // ignore
    }
  }

  const card: any = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    background: "white",
  };

  const btn: any = {
    display: "inline-block",
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    background: "white",
    fontSize: 13,
    textDecoration: "none",
  };

  const miniBtn: any = {
    display: "inline-block",
    padding: "6px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    background: "white",
    fontSize: 12,
    textDecoration: "none",
    cursor: "pointer",
  };

  const badge: any = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #eee",
    fontSize: 12,
    opacity: 0.85,
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Admin Control Center</h1>

      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>
        Centralized navigation hub. Read-only. No actions are executed here.
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={badge}>
          Role: <b>{role}</b>
          <span style={{ marginLeft: 8, opacity: 0.6, fontFamily: "monospace" }}>{roleSource}</span>
        </span>

        <span style={{ fontSize: 12, opacity: 0.65 }}>
          Tip: use <span style={{ fontFamily: "monospace" }}>?role=dispatcher</span> (or <span style={{ fontFamily: "monospace" }}>?role=admin</span>) for UI-only testing.
        </span>

        {debug ? (
          <>
            <span style={{ opacity: 0.5 }}>|</span>
            <button style={miniBtn} onClick={() => setRoleHint("admin")}>Set Admin</button>
            <button style={miniBtn} onClick={() => setRoleHint("dispatcher")}>Set Dispatcher</button>
            <span style={{ fontSize: 12, opacity: 0.6 }}>(debug=1 only)</span>
          </>
        ) : null}
      </div>

      {visibleSections.map((section) => (
        <div key={section.heading} style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{section.heading}</h2>

          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            {section.items.map((it) => (
              <div key={it.href} style={card}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{it.title}</div>
                <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>{it.desc}</div>

                <div style={{ marginTop: 10 }}>
                  <Link href={it.href} style={btn}>
                    Open
                  </Link>
                  <span
                    style={{
                      marginLeft: 10,
                      fontFamily: "monospace",
                      fontSize: 12,
                      opacity: 0.6,
                    }}
                  >
                    {it.href}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 24, fontSize: 12, opacity: 0.6 }}>
        Rule enforced: navigation only. No API calls, no state mutations, no embedded tools.
      </div>
    </div>
  );
}
