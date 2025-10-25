export default function LiveTripsPage() {
  return (
    <main
      style={{
        padding: "16px",
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
        Live Trips
      </h1>

      <p
        style={{
          fontSize: ".9rem",
          color: "#666",
          marginBottom: "16px",
        }}
      >
        This is the production /admin/livetrips page. If you can see this
        after logging in with Google on app.jride.net, auth is working and
        the route deployed correctly.
      </p>

      <div
        style={{
          width: "100%",
          minHeight: "320px",
          border: "1px solid #ccc",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: ".9rem",
          color: "#444",
          background: "#f9f9f9",
        }}
      >
        Map / driver tracking panel goes here.
      </div>
    </main>
  );
<<<<<<< HEAD
}
=======
}
>>>>>>> fix/auth-v5-clean
