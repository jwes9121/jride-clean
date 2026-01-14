import Link from "next/link";

export const dynamic = "force-static";

export default function VendorSummaryReportPage() {
  const card: any = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
    background: "white",
    maxWidth: 900,
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

  const presetSummary = `/admin/reports/lgu?tab=vendor&view=summary`;

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Vendor Summary Report</h1>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>
        Read-only report launcher. Opens LGU export view with vendor summary preset. No API calls here.
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Preset</div>
          <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href={presetSummary} style={btn}>
              Open Vendor Summary
            </Link>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Export CSV is done inside the LGU export page (read-only).
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Notes (LGU-safe)</div>
          <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18, fontSize: 13, opacity: 0.85 }}>
            <li>No wallet mutations</li>
            <li>No payout actions</li>
            <li>No schema assumptions</li>
            <li>Export is CSV (GET-only + client-side generation)</li>
          </ul>
        </div>
      </div>

      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.6 }}>
        Rule enforced: navigation + presets only. No API calls. No mutations.
      </div>
    </div>
  );
}
