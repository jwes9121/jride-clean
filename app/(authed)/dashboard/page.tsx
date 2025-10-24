// app/(authed)/dashboard/page.tsx
import { auth } from "@/app/auth";

export default async function DashboardPage() {
  const session = await auth();
  return (
    <section>
      <h1 style={{ marginBottom: 12 }}>Dashboard</h1>
      <div
        style={{
          border: "1px solid #eee",
          borderRadius: 12,
          padding: 16,
          background: "#fafafa",
        }}
      >
        <div>Welcome, <b>{session?.user?.name}</b></div>
        <div style={{ opacity: 0.8 }}>{session?.user?.email}</div>
      </div>
    </section>
  );
}
