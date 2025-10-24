import { auth } from "../auth";

export default async function HomePage() {
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
        Welcome to J-Ride
      </h1>

      {session ? (
        <p
          style={{
            fontSize: ".9rem",
            color: "#444",
          }}
        >
          Logged in as{" "}
          <strong>{session.user?.email ?? session.user?.name}</strong>.
        </p>
      ) : (
        <p
          style={{
            fontSize: ".9rem",
            color: "#444",
          }}
        >
          You are not signed in.
        </p>
      )}
    </main>
  );
}
