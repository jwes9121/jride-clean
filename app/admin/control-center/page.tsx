"use client";

import Link from "next/link";

type Item = {
  title: string;
  desc: string;
  href: string;
};

type Section = {
  heading: string;
  items: Item[];
};

export default function AdminControlCenterPage() {
  const sections: Section[] = [
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
  ];

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

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
        Admin Control Center
      </h1>

      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>
        Centralized navigation hub. Read-only. No actions are executed here.
      </div>

      {sections.map((section) => (
        <div key={section.heading} style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>
            {section.heading}
          </h2>

          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            {section.items.map((it) => (
              <div key={it.href} style={card}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {it.title}
                </div>
                <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>
                  {it.desc}
                </div>

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
        Rule enforced: navigation only. No API calls, no state mutations,
        no embedded tools.
      </div>
    </div>
  );
}
