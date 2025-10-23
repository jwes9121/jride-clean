import { auth } from "../../auth";
import { redirect } from "next/navigation";
import Header from "../components/Header";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Dashboard() {
  const session = await auth();
  if (!session) redirect("/auth/signin");
  const u = session.user;

  return (
    <>
      <Header />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: 16 }}>
        <h1 className="text-xl font-semibold mb-4">Session: dashboard</h1>
        <div className="p-4 border rounded-xl bg-gray-50">
          <p>Welcome, {u?.name}</p>
          <p className="text-sm text-gray-600">{u?.email}</p>
          <p className="mt-6 text-gray-500">Map temporarily disabled for deployment</p>
        </div>
      </main>
    </>
  );
}
