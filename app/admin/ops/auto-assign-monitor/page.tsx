import Link from "next/link";

export const dynamic = "force-static";

export default function AutoAssignMonitorOpsPage() {
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

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Auto-Assign Monitor</h1>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>
        Read-only helper page. No actions, no API calls, no state changes.
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Where to monitor auto-assign behavior</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
            Use Live Trips. The UI already contains the operational context (trip list + driver context + suggestions).
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Link href="/admin/livetrips" style={btn}>
              Open Live Trips
            </Link>
            <span style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.65 }}>
              /admin/livetrips
            </span>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Tip: Use <b>Dispatch</b> tab to watch new trips and assignment flow. This page stays read-only by design.
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Next upgrade (optional)</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
            If you want a real “monitor table” (still read-only), we can add a lightweight view that pulls
            existing data (GET only) and shows assignment signals. That would be a separate phase so we don’t risk LiveTrips.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.6 }}>
        Rule enforced: navigation + guidance only. No API calls. No mutations.
      </div>
    </div>
  );
}
