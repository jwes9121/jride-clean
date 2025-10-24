import { supabaseBrowserClient } from "../../lib/supabaseClient";

export default async function DispatchPage() {
  // You can fetch dispatch data here later using supabaseBrowserClient
  // For now we just render a stub so build passes.
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
        Dispatch Panel
      </h1>
      <p
        style={{
          fontSize: ".9rem",
          color: "#444",
        }}
      >
        (stub) This is the dispatch page.
      </p>
    </main>
  );
}
