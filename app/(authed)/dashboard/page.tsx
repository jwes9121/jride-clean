export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DashboardPage() {
  return (
    <>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
        Dashboard
      </h1>
      <section
        style={{
          border: "1px solid #eaeaea",
          borderRadius: 12,
          background: "#fafafa",
          padding: "1.5rem",
        }}
      >
        <p>Welcome to your dashboard.</p>
      </section>
    </>
  );
}
