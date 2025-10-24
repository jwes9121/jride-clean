"use client";

import { estimateFare, formatFare } from "../../../lib/fare";

export default function ConfirmFareClient() {
  // demo calculation so TS and build are happy
  const demo = estimateFare("Lamut", "Lagawe", 5.1);

  return (
    <section
      style={{
        padding: "16px",
        border: "1px solid #ccc",
        borderRadius: "8px",
        fontFamily: "system-ui, sans-serif",
        background: "#fff",
        marginTop: "16px",
      }}
    >
      <h2
        style={{
          fontSize: "1rem",
          fontWeight: 600,
          marginBottom: "4px",
        }}
      >
        Confirm Fare
      </h2>

      <p
        style={{
          fontSize: ".9rem",
          color: "#444",
          marginBottom: "4px",
        }}
      >
        Estimated fare: {formatFare(demo)}
      </p>

      <p
        style={{
          fontSize: ".8rem",
          color: "#777",
        }}
      >
        (stub) This is ConfirmFareClient.
      </p>
    </section>
  );
}
