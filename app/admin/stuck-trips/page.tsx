import StuckTripsClient from "./ui/StuckTripsClient";
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Stuck Trip Watcher</h1>
      <p style={{ opacity: 0.8, marginTop: 4 }}>
        Flags active trips whose driver location hasn’t updated for ≥ threshold.
      </p>
      <div style={{ marginTop: 12 }}>
        <StuckTripsClient />
      </div>
    </div>
  );
}
