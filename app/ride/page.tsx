import { supabaseBrowserClient } from "../../lib/supabaseClient";

export default async function RidePage() {
  // You can hydrate active ride details here with Supabase later.
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
        Ride Status
      </h1>
      <p
        style={{
          fontSize: ".9rem",
          color: "#444",
        }}
      >
        (stub) Live ride info will appear here.
      </p>
    </main>
  );
}
