// app/dashboard/page.tsx
import { auth } from "../../auth";
import { redirect } from "next/navigation";

export default async function Dashboard() {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  return (
    <main className="p-6">
      <h1 className="text-lg">Session: dashboard</h1>
      {/* your content */}
    </main>
  );
}
