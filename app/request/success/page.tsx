import { auth } from "../../../auth";

export default async function SuccessPage() {
  const session = await auth();

  return (
    <main
      style={{
        padding: "24px",
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
        Request Submitted ✅
      </h1>

      <p
        style={{
          fontSize: ".9rem",
          color: "#444",
          marginBottom: "12px",
        }}
      >
        Thank you. We’ve received your booking.
      </p>

      {session ? (
        <p
          style={{
            fontSize: ".9rem",
            color: "#666",
          }}
        >
          Logged in as{" "}
          <strong>{session.user?.email ?? session.user?.name}</strong>.
        </p>
      ) : (
        <p
          style={{
            fontSize: ".9rem",
            color: "#666",
          }}
        >
          (No active session.)
        </p>
      )}
    </main>
  );
}
