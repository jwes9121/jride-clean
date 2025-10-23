// app/dashboard/page.tsx
import { auth } from "../../auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Dashboard() {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  return (
    <main className="p-6">
      <h1 className="text-lg font-semibold">Session: dashboard</h1>
      <p>Welcome, {session.user?.name}</p>
    </main>
  );
}
