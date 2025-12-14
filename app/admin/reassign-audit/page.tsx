import ReassignAuditClient from "./ui/ReassignAuditClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Reassign Audit</h1>
      <p style={{ opacity: 0.8, marginTop: 4 }}>
        Tracks every driver reassignment (dispute-safe).
      </p>
      <div style={{ marginTop: 12 }}>
        <ReassignAuditClient />
      </div>
    </div>
  );
}
