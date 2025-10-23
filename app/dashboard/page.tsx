// app/dashboard/page.tsx
import { auth } from "../../auth";
import { redirect } from "next/navigation";
import Header from "../components/Header";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Dashboard() {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">Session: dashboard</h1>
        <div className="p-4 border rounded-xl bg-gray-50">
          <p>Welcome, {session.user?.name}</p>
          <p className="text-sm text-gray-600">{session.user?.email}</p>
          <p className="mt-6 text-gray-500">Map temporarily disabled for deployment</p>
        </div>
      </main>
    </>
  );
}
