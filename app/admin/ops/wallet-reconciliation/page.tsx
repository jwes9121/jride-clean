"use client";

import Link from "next/link";

export default function WalletReconciliationPage() {
  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Wallet Reconciliation (Read-only)</h1>
      <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
        Placeholder page to prevent routing errors. No actions. No API mutations. UI-only.
      </div>

      <div style={{ marginTop: 14, padding: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "white" }}>
        <div style={{ fontWeight: 800 }}>Notes</div>
        <ul style={{ marginTop: 8, paddingLeft: 18, opacity: 0.85 }}>
          <li>This page will remain GET-only.</li>
          <li>No wallet deductions/credits here.</li>
          <li>Future: show computed health indicators + mismatches only.</li>
        </ul>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/admin/control-center" style={{ textDecoration: "none", border: "1px solid #d1d5db", padding: "8px 12px", borderRadius: 10 }}>
            Back to Control Center
          </Link>
        </div>
      </div>
    </div>
  );
}
