// app/dashboard/page.tsx
import { auth } from "../../auth";
import { redirect } from "next/navigation";
import Header from "../components/Header";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const user = session.user;

  return (
    <>
      <Header />
      <main
        style={{
          maxWidth: "1000px",
          margin: "0 auto",
          padding: "2rem 1rem",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          Dashboard
        </h1>

        <div
          style={{
            border: "1px solid #eaeaea",
            borderRadius: 12,
            background: "#fafafa",
            padding: "1.5rem",
          }}
        >
          <p>Welcome back, <b>{user?.name}</b>!</p>
          <p style={{ fontSize: 14, color: "#666" }}>{user?.email}</p>

          <div style={{ marginTop: "2rem", color: "#999" }}>
            Map temporarily disabled for deployment
          </div>
        </div>
      </main>
    </>
  );
}
