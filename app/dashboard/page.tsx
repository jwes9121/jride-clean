import { auth } from "../../auth";
import { redirect } from "next/navigation";
import UserMenu from "../components/UserMenu";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Dashboard() {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  return (
    <main className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-semibold">Session: dashboard</h1>
        {/* user menu on top-right */}
        <UserMenu />
      </div>

      <div className="p-4 border rounded-lg bg-gray-50">
        <p>Welcome, {session.user?.name}</p>
        <p className="text-sm text-gray-600">{session.user?.email}</p>
        <p className="mt-4 text-gray-500">Map temporarily disabled for deployment</p>
      </div>
    </main>
  );
}
