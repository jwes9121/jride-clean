export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RidesPage() {
  return (
    <>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
        Rides
      </h1>
      <section
        style={{
          border: "1px solid #eaeaea",
          borderRadius: 12,
          background: "#fafafa",
          padding: "1.5rem",
        }}
      >
        <p>Nothing here yet. This will list active & recent rides.</p>
      </section>
    </>
  );
}
