export default function DashboardPage() {
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1
        style={{
          fontSize: "1.25rem",
          fontWeight: 600,
          marginBottom: "8px",
        }}
      >
        Dashboard
      </h1>
      <p
        style={{
          fontSize: ".9rem",
          color: "#444",
        }}
      >
        This is the dashboard under (authed). If you see this in prod,
        auth + layout are working.
      </p>
    </div>
  );
}
